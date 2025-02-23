export const successResponse = (res, message, code, data) => {
    return res.status(code).json({
        message,
        status: true,
        code,
        data
    });
};