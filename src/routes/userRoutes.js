import express from "express";

const userRoutes = express.Router();

userRoutes.get("/", (req, res) => {
    res.send("Hello World by userRoutes");
});

export default userRoutes;
