const express = require("express");
const { Router } = express;
const Container = require("./contenedores/Container.js");
const ContenedorMsg = require("./contenedores/contenedorMsjArchivo");
const ContenedorFaker = require("./contenedores/ContainerFake");
const { normalize, schema, denormalize } = require("normalizr");
const { engine } = require("express-handlebars");
const app = express();
const mongoose = require("mongoose");

// require("dotenv").config();
const config = require("./config");

console.log(`NODE_ENV=${config.NODE_ENV}`);

const httpServer = require("http").createServer(app);
const routes = require("./routes");

// console.log(process.env)

httpServer.listen(config.PORT, () =>
  console.log(`App listening on http://${config.HOST}:${config.PORT}`)
);

const contenedor = new Container("productos");
const contenedorMsg = new ContenedorMsg("mensajes");
const prodFaker = new ContenedorFaker();

const io = require("socket.io")(httpServer);

const moment = require("moment");
const timestamp = moment().format("lll");

const MongoStore = require("connect-mongo");
const session = require("express-session");
const Usuarios = require("./models/usuarios");

app.use(express.static(__dirname + "/public"));

app.set("view engine", "hbs");
app.set("views", "./views");
app.engine(
  "hbs",
  engine({
    extname: ".hbs",
    defaultLayout: "index.hbs",
    layoutsDir: __dirname + "/views/layouts",
    partialsDir: __dirname + "/views/partials",
  })
);

///////passport/////////
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");

function isValidPassword(user, password) {
  return bcrypt.compareSync(password, user.password);
}

function createHash(password) {
  return bcrypt.hashSync(password, bcrypt.genSaltSync(10), null);
}

mongoose
  .connect(
    "mongodb+srv://tamara:123456Coder@cluster0.u37xyzn.mongodb.net/Proyecto-back"
  )
  .then(() => console.log("Connected to Mongo"))
  .catch((e) => {
    console.error(e);
    throw "can not connect to the mongo!";
  });

passport.use(
  "login",
  new LocalStrategy((username, password, done) => {
    Usuarios.findOne({ username }, (err, user) => {
      if (err) return done(err);

      if (!user) {
        console.log("No existe el usuario " + username);
        return done(null, false);
      }

      if (!isValidPassword(user, password)) {
        console.log("Password inválido");
        return done(null, false);
      }

      return done(null, user);
    });
  })
);

passport.use(
  "signup",
  new LocalStrategy(
    {
      passReqToCallback: true,
    },
    (req, username, password, done) => {
      Usuarios.findOne({ username: username }, function (err, user) {
        if (err) {
          console.log("Error en el logueo: " + err);
          return done(err);
        }

        if (user) {
          console.log("Ya existe el usuario");
          return done(null, false);
        }

        const newUser = {
          username: username,
          password: createHash(password),
        };
        Usuarios.create(newUser, (err, userWithId) => {
          if (err) {
            console.log("Error al guardar el usuario: " + err);
            return done(err);
          }
          console.log(user);
          console.log("Registración exitosa");
          return done(null, userWithId);
        });
      });
    }
  )
);

passport.serializeUser((user, done) => {
  done(null, user._id);
});

passport.deserializeUser((id, done) => {
  Usuarios.findById(id, done);
});

/////////// SESION //////////

app.use(
  session({
    store: MongoStore.create({
      mongoUrl:
        "mongodb+srv://tamara:123456Coder@cluster0.u37xyzn.mongodb.net/Proyecto-back",
      mongoOptions: {
        useNewUrlParser: true,
        useUnifiedTopology: true,
      },
      ttl: 10 * 60,
    }),
    secret: "secreto",
    resave: false,
    saveUninitialized: false,
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use(express.json());
app.use(express.urlencoded({ extended: true }));



// function auth(req, res, next) {
//   if (req.session.user) {
//     return next();
//   } else {
//     // res.status(401).send("error de autorización!")
//     return res.redirect("/login");

//   }
// }

function checkAuthentication(req, res, next) {
  if (req.isAuthenticated()) {
    next();
  } else {
    res.redirect("/login");
  }
}

app.get("/api/productos-test", async (req, res) => {
  const prodFake = prodFaker.getProd(5);
  res.render("productosFake", {
    title: "Test",
    prodFake,
    layout: "productosFake",
  });
  // res.json(prodFake);
});

// Normalizr

const authorSchema = new schema.Entity("authors", {}, { idAttribute: "email" });
const messageSchema = new schema.Entity("messages", {
  author: authorSchema,
});

const chatSchema = new schema.Entity("chats", {
  messages: [messageSchema],
});

const normalizarData = (data) => {
  const dataNormalizada = normalize(
    { id: "chatHistory", messages: data },
    chatSchema
  );
  return dataNormalizada;
};

const normalizarMensajes = async () => {
  const messages = await contenedorMsg.getAll();
  const normalizedMessages = normalizarData(messages);
  return normalizedMessages;
};

///// Conexion socket

io.on("connection", async (socket) => {
  console.log(`Nuevo cliente conectado ${socket.id}`);

  socket.emit("product-list", await contenedor.getAll());

  socket.emit("msg-list", await normalizarMensajes());

  socket.on("product", async (data) => {
    console.log(data);

    await contenedor.save(data);

    console.log("Se recibio un producto nuevo", "producto:", data);

    io.emit("product-list", await contenedor.getAll());
  });

  socket.on("del-product", async (data) => {
    console.log(data);

    await contenedor.deleteById(data);
    io.emit("product-list", await contenedor.getAll());
  });

  socket.on("msg", async (data) => {
    await contenedorMsg.save({
      socketid: socket.id,
      timestamp: timestamp,
      ...data,
    });

    console.log("Se recibio un msg nuevo", "msg:", data);

    io.emit("msg-list", await normalizarMensajes());
  });
});

app.get("/", checkAuthentication, routes.getRoot);

app.get("/showsession", routes.getShowsession);

app.get("/logout", routes.getLogout);

app.get("/login", routes.getLogin);

app.post(
  "/login",
  passport.authenticate("login", { failureRedirect: "/faillogin" }),
  routes.postLogin
);

// app.get("/faillogin", routes.getFailLogin);

app.get("/faillogin", routes.getFailLogin);

app.get("/failsignup", routes.getFailSignup);

app.get("/registro", routes.getRegistro);

app.post(
  "/registro",
  passport.authenticate("signup", { failureRedirect: "/failsignup" }),
  routes.postRegistro
);

// app.get("/failregistro", routes.getFailRegistro);

app.get("/privado", checkAuthentication, routes.getPrivado);

app.get("/info", routes.getInfo);

app.get("/api/random",  routes.getApirandom);