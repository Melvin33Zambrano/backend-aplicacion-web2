const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // tu correo, ej: reservas.uleam@gmail.com
        pass: process.env.EMAIL_PASS  // contraseña de aplicación (NO tu contraseña normal)
    }
});

module.exports = transporter;