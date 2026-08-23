const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const connection = require('../db.js');
const { verificarAdmin } = require('../middlewares/auth');

// Crear usuario (Solo Admin)
router.post('/crearUsuario', verificarAdmin, async (req, res) => {
    const hashedPassword = await bcrypt.hash(req.body.CONTRASENA, 10);
    const nuevoUsuario = {
        NOMBRE: req.body.NOMBRE,
        APELLIDO: req.body.APELLIDO,
        CORREO: req.body.CORREO,
        CONTRASENA: hashedPassword,
        TIPO: req.body.TIPO
        // ROL_ID eliminado
    };

    connection.query('INSERT INTO usuarios SET ?', nuevoUsuario, (err, result) => {
        if (err) {
            console.error("Error al insertar usuario: ", err);
            res.status(500).json({ mensaje: "Error en el servidor" });
        } else {
            res.json({ mensaje: "Usuario creado exitosamente" });
        }
    });
});

// Obtener todos los usuarios (Solo Admin)
router.get('/', verificarAdmin, (req, res) => {
    connection.query("SELECT USUARIO_ID, NOMBRE, APELLIDO, CORREO, TIPO FROM usuarios", (err, results) => {
        if (err) {
            console.error("Error al obtener usuarios:", err);
            return res.status(500).json({ mensaje: "Error en el servidor" });
        }
        res.json(results);
    });
});

// Obtener usuario por ID (Solo Admin)
router.get('/:id', verificarAdmin, (req, res) => {
    const id = req.params.id;
    connection.query("SELECT USUARIO_ID, NOMBRE, APELLIDO, CORREO, TIPO FROM usuarios WHERE USUARIO_ID = ?", [id], (err, results) => {
        if (err) {
            console.error("Error al obtener usuario:", err);
            return res.status(500).json({ mensaje: "Error en el servidor" });
        }
        res.json(results[0]);
    });
});

// Actualizar usuario por ID (Solo Admin)
router.put('/:id', verificarAdmin, (req, res) => {
    const id = req.params.id;
    const { NOMBRE, APELLIDO, CORREO, TIPO,  } = req.body;
    
    // Si se envía CONTRASENA, actualizarla también
    let updateData = { NOMBRE, APELLIDO, CORREO, TIPO,  };
    
    connection.query("UPDATE usuarios SET ? WHERE USUARIO_ID = ?", [updateData, id], (err, results) => {
        if (err) {
            console.error("Error al actualizar usuario:", err);
            return res.status(500).json({ mensaje: "Error en el servidor" });
        }
        res.json({ mensaje: "Usuario actualizado exitosamente" });
    });
});

// Eliminar usuario por ID (Solo Admin)
router.delete('/:id', verificarAdmin, (req, res) => {
    const id = req.params.id;

    connection.query("DELETE FROM usuarios WHERE USUARIO_ID = ?", [id], (err, results) => {
        if (err) {
            console.error("Error al eliminar usuario:", err);
            return res.status(500).json({ mensaje: "Error en el servidor" });
        }
        res.json({ mensaje: "Usuario eliminado exitosamente" });
    });
});

router.post('/registro', async (req, res) => {
    const { NOMBRE, APELLIDO, CORREO, CONTRASENA, TIPO, TELEFONO } = req.body;

    // Validar campos obligatorios
    if (!NOMBRE || !APELLIDO || !CORREO || !CONTRASENA || !TIPO || !TELEFONO) {
        return res.status(400).json({ mensaje: "Todos los campos son obligatorios" });
    }

    // Validar formato de teléfono ecuatoriano (10 dígitos, empieza con 0)
    const telefonoRegex = /^0\d{9}$/;
    if (!telefonoRegex.test(TELEFONO)) {
        return res.status(400).json({ mensaje: "El teléfono debe tener 10 dígitos y empezar con 0 (ej: 0991234567)" });
    }

    // Solo se permite Estudiante o Profesor en el registro público
    const tiposPermitidos = ['Estudiante', 'Profesor'];
    if (!tiposPermitidos.includes(TIPO)) {
        return res.status(400).json({ mensaje: "Rol no permitido para registro" });
    }

    if (!CORREO.endsWith('@uleam.edu.ec')) {
        return res.status(400).json({ mensaje: "Debe usar un correo institucional @uleam.edu.ec" });
    }

    try {
        connection.query('SELECT USUARIO_ID FROM usuarios WHERE CORREO = ?', [CORREO], async (err, results) => {
            if (err) {
                console.error("Error al verificar correo: ", err);
                return res.status(500).json({ mensaje: "Error en el servidor" });
            }

            if (results.length > 0) {
                return res.status(409).json({ mensaje: "El correo ya está registrado" });
            }

            const hashedPassword = await bcrypt.hash(CONTRASENA, 10);
            const nuevoUsuario = {
                NOMBRE,
                APELLIDO,
                CORREO,
                CONTRASENA: hashedPassword,
                TIPO,
                TELEFONO
            };

            connection.query('INSERT INTO usuarios SET ?', nuevoUsuario, (err, result) => {
                if (err) {
                    console.error("Error al insertar usuario: ", err);
                    return res.status(500).json({ mensaje: "Error en el servidor" });
                }
                res.status(201).json({ mensaje: "Usuario registrado exitosamente" });
            });
        });
    } catch (error) {
        console.error("Error en registro: ", error);
        res.status(500).json({ mensaje: "Error en el servidor" });
    }
});

module.exports = router;
