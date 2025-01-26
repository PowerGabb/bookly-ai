import { errorResponse } from "./errorResponse.js";

export const requestValidation = (validation, req) => {
    const { error } = validation.validate(req.body);
    if (error) {
        return {
            isValid: false,
            error: error.details[0].message.replace(/['"]/g, '')
        };
    }
    return {
        isValid: true,
        error: null
    };
};