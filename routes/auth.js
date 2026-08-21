const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');


// Importar conexión a la base de datos
const connection = require('../db.js');

// LOGIN - Iniciar sesión
// En tu ruta de login
router.post('/login', async (req, res) => {
    const { CORREO, CONTRASENA } = req.body;
    
    try {
        connection.query(
            "SELECT USUARIO_ID, NOMBRE, APELLIDO, CORREO, TIPO, CONTRASENA FROM usuarios WHERE CORREO = ?",
            [CORREO],
            async (err, results) => {
                if (err || results.length === 0) {
                    return res.status(401).json({ mensaje: "Credenciales incorrectas" });
                }
                
                const usuario = results[0];
                const passwordValida = await bcrypt.compare(CONTRASENA, usuario.CONTRASENA);
                
                if (!passwordValida) {
                    return res.status(401).json({ mensaje: "Credenciales incorrectas" });
                }
                
                // Guardar en sesión (sin ROL_ID porque no existe en tu DB)
                req.session.usuario = {
                    id: usuario.USUARIO_ID,
                    nombre: usuario.NOMBRE,
                    apellido: usuario.APELLIDO,
                    correo: usuario.CORREO,
                    tipo: usuario.TIPO  // ← Esto es lo que usa el middleware
                };
                
                req.session.save((err) => {
                    if (err) {
                        console.error("Error al guardar sesión:", err);
                        return res.status(500).json({ mensaje: "Error al iniciar sesión" });
                    }
                    
                    res.json({
                        mensaje: "Login exitoso",
                        usuario: req.session.usuario
                    });
                });
            }
        );
    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ mensaje: "Error en el servidor" });
    }
});

// LOGOUT - Cerrar sesión (VERSIÓN CORREGIDA - Solo una ruta)
router.post("/logout", (req, res) => {
    // Verificar si hay sesión
    if (!req.session.usuario) {
        return res.status(200).json({ mensaje: "No había sesión activa" });
    }

    req.session.destroy((err) => {
        if (err) {
            console.error("Error al cerrar sesión:", err);
            return res.status(500).json({ mensaje: "Error al cerrar sesión" });
        }
        
        // Limpiar cookie de sesión
        res.clearCookie("connect.sid");
        
        // También limpiar otras cookies si las tienes
        res.clearCookie("token");
        
        res.json({ mensaje: "Sesión cerrada exitosamente" });
    });
});

// VERIFICAR SESIÓN ACTUAL 
router.get("/me", (req, res) => {
    if (!req.session.usuario) {
        return res.status(401).json({ mensaje: "No hay sesión activa" });
    }

    res.json({
        usuario: req.session.usuario,
        permisos: {
            esAdmin: req.session.usuario.tipo === 'ADMINISTRADOR',
            esProfesor: req.session.usuario.tipo === 'PROFESOR',
            esEstudiante: req.session.usuario.tipo === 'ESTUDIANTE'
        }
    });
});

const transporter = require('../config/email');

// Solicitar código de recuperación
router.post('/solicitar-recuperacion', async (req, res) => {
    const { CORREO } = req.body;

    if (!CORREO) {
        return res.status(400).json({ mensaje: "El correo es obligatorio" });
    }

    connection.query('SELECT USUARIO_ID, NOMBRE FROM usuarios WHERE CORREO = ?', [CORREO], async (err, results) => {
        if (err) {
            console.error("Error al buscar usuario:", err);
            return res.status(500).json({ mensaje: "Error en el servidor" });
        }

        if (results.length === 0) {
            // Por seguridad, no revelamos si el correo existe o no
            return res.json({ mensaje: "Si el correo existe, recibirás un código de recuperación" });
        }

        const usuario = results[0];
        const codigo = Math.floor(100000 + Math.random() * 900000).toString(); // código de 6 dígitos
        const expira = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

        connection.query(
            'UPDATE usuarios SET RESET_CODIGO = ?, RESET_EXPIRA = ? WHERE USUARIO_ID = ?',
            [codigo, expira, usuario.USUARIO_ID],
            async (err) => {
                if (err) {
                    console.error("Error al guardar código:", err);
                    return res.status(500).json({ mensaje: "Error en el servidor" });
                }

                try {
                    await transporter.sendMail({
                        from: `"ULEAM Reservas" <${process.env.EMAIL_USER}>`,
                        to: CORREO,
                        subject: 'Código de recuperación de contraseña',
                        html: `
                            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
                                <h2 style="color: #CC0000;">ULEAM Reservas</h2>
                                <p>Hola ${usuario.NOMBRE},</p>
                                <p>Recibimos una solicitud para restablecer tu contraseña. Usa el siguiente código:</p>
                                <div style="background: #f9fafb; padding: 20px; border-radius: 10px; text-align: center; margin: 20px 0;">
                                    <span style="font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #CC0000;">${codigo}</span>
                                </div>
                                <p style="color: #6b7280; font-size: 13px;">Este código expira en 15 minutos. Si no solicitaste esto, ignora este correo.</p>
                            </div>
                        `
                    });

                    res.json({ mensaje: "Si el correo existe, recibirás un código de recuperación" });
                } catch (emailError) {
                    console.error("Error al enviar correo:", emailError);
                    res.status(500).json({ mensaje: "Error al enviar el correo" });
                }
            }
        );
    });
});

// Resetear contraseña con código
router.post('/resetear-password', async (req, res) => {
    const { CORREO, CODIGO, NUEVA_CONTRASENA } = req.body;

    if (!CORREO || !CODIGO || !NUEVA_CONTRASENA) {
        return res.status(400).json({ mensaje: "Todos los campos son obligatorios" });
    }

    if (NUEVA_CONTRASENA.length < 6) {
        return res.status(400).json({ mensaje: "La contraseña debe tener al menos 6 caracteres" });
    }

    connection.query(
        'SELECT USUARIO_ID, RESET_CODIGO, RESET_EXPIRA FROM usuarios WHERE CORREO = ?',
        [CORREO],
        async (err, results) => {
            if (err) {
                console.error("Error al buscar usuario:", err);
                return res.status(500).json({ mensaje: "Error en el servidor" });
            }

            if (results.length === 0) {
                return res.status(400).json({ mensaje: "Código inválido o expirado" });
            }

            const usuario = results[0];

            if (usuario.RESET_CODIGO !== CODIGO) {
                return res.status(400).json({ mensaje: "Código inválido o expirado" });
            }

            if (!usuario.RESET_EXPIRA || new Date(usuario.RESET_EXPIRA) < new Date()) {
                return res.status(400).json({ mensaje: "Código inválido o expirado" });
            }

            const hashedPassword = await bcrypt.hash(NUEVA_CONTRASENA, 10);

            connection.query(
                'UPDATE usuarios SET CONTRASENA = ?, RESET_CODIGO = NULL, RESET_EXPIRA = NULL WHERE USUARIO_ID = ?',
                [hashedPassword, usuario.USUARIO_ID],
                (err) => {
                    if (err) {
                        console.error("Error al actualizar contraseña:", err);
                        return res.status(500).json({ mensaje: "Error en el servidor" });
                    }
                    res.json({ mensaje: "Contraseña actualizada exitosamente" });
                }
            );
        }
    );
});

module.exports = router;