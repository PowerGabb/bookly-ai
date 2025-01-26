export const errorResponse = (res, message, code) => {
    res.status(code).json({
        message: message,
        status: false,
        code: code
    });
    return;
};