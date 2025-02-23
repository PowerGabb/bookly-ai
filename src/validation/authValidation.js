import Joi from "joi";

const registerValidation = Joi.object({
    name: Joi.string().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
});

const loginValidation = Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).required(),
});

export { registerValidation, loginValidation };
