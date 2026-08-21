const express = require("express");
const cors = require("cors");
const session = require("express-session");
const http = require("http");
const { Server } = require("socket.io");
const path = require('path');

const app = express();
const server = http.createServer(app);


const allowedOrigins = [
    'http://localhost:3000',
    'https://frontend-reservas-uleam.vercel.app',
    /\.vercel\.app$/
];

// Configurar Socket.io
const io = new Server(server, {
    cors: {
        origin: allowedOrigins,
        credentials: true,
        methods: ["GET", "POST"]
    }
});

// Configurar CORS
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.some(o =>
            typeof o === 'string' ? o === origin : o.test(origin)
        )) {
            callback(null, true);
        } else {
            callback(new Error('No permitido por CORS'));
        }
    },
    credentials: true
}));

app.set('trust proxy', 1);
app.use(express.json());

app.use('/images', express.static(path.join(__dirname, 'public/images')));

// Configurar sesiones
app.use(session({
    secret: process.env.SESSION_SECRET || '123',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 24
    }
}       
));

// Importar rutas
const authRoutes = require('./routes/auth');
const usuarioRoutes = require('./routes/usuario');
const reservasRoutes = require('./routes/reservas');
const recursosRoutes = require('./routes/recursos');
const rolesRoutes = require('./routes/roles');
const reportesRoutes = require('./routes/reportes');
const bloqueosRoutes = require('./routes/bloqueos');

app.use('/auth', authRoutes);
app.use('/usuario', usuarioRoutes);
app.use('/', reservasRoutes);
app.use('/', recursosRoutes);
app.use('/roles', rolesRoutes);
app.use('/', reportesRoutes);
app.use('/', bloqueosRoutes);

// Hacer io accesible desde las rutas
app.set('io', io);

// Manejar conexiones Socket.io
io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    socket.on('unirse', (usuarioId) => {
        socket.join(`usuario_${usuarioId}`);
        console.log(`Usuario ${usuarioId} unido a su sala`);
    });

    socket.on('unirse_admin', () => {
        socket.join('admins');
        console.log('Admin unido a sala de admins');
    });

    socket.on('disconnect', () => {
        console.log('Usuario desconectado:', socket.id);
    });
});

// Ruta principal
app.get("/", (req, res) => {
    res.send("Servidor funcionando - API con autenticación ✅");
});

app.get("/status", (req, res) => {
    res.json({
        mensaje: "Servidor funcionando",
        sesionActiva: !!req.session.usuario,
        usuario: req.session.usuario || null
    });
});

app.get("/test", (req, res) => {
    res.send("OK TEST");
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    console.log(`Accede a: http://localhost:${PORT}`);
});

module.exports = app;
