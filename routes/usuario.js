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
        TIPO: req.body.TIPO,
        ROL_ID: req.body.ROL_ID
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
    connection.query("SELECT USUARIO_ID, NOMBRE, APELLIDO, CORREO, TIPO, ROL_ID FROM usuarios", (err, results) => {
        if (err) return res.status(500).send("Error");
        res.json(results);
    });
});

// Obtener usuario por ID (Solo Admin)
router.get('/:id', verificarAdmin, (req, res) => {
    const id = req.params.id;
    connection.query("SELECT USUARIO_ID, NOMBRE, APELLIDO, CORREO, TIPO, ROL_ID FROM usuarios WHERE USUARIO_ID = ?", [id], (err, results) => {
        if (err) return res.status(500).send("Error");
        res.json(results[0]);
    });
});

// Actualizar usuario por ID (Solo Admin)
router.put('/:id', verificarAdmin, (req, res) => {
    const id = req.params.id;
    const data = req.body;

    connection.query("UPDATE usuarios SET ? WHERE USUARIO_ID = ?", [data, id], (err, results) => {
        if (err) return res.status(500).send("Error");
        res.send("Usuario actualizado");
    });
});



// Eliminar usuario por ID (Solo Admin)
router.delete('/:id', verificarAdmin, (req, res) => {
    const id = req.params.id;

    connection.query("DELETE FROM usuarios WHERE USUARIO_ID = ?", [id], (err, results) => {
        if (err) return res.status(500).send("Error");
        res.send("Usuario eliminado");
    });
});

module.exports = router;