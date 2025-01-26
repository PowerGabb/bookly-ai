import prisma from "../utils/prisma.js";
import { successResponse } from "../libs/successResponse.js";
import { errorResponse } from "../libs/errorResponse.js";

export const getCategories = async (req, res) => {
    const { page = 1, limit = 10, search = "" } = req.query;
    try {
        // Convert page and limit to integers
        const pageInt = parseInt(page);
        const limitInt = parseInt(limit);

        const categories = await prisma.category.findMany({
            where: {
                name: {
                    contains: search,
                },
            },
            skip: (pageInt - 1) * limitInt,
            take: limitInt,
        });
        return successResponse(res, "Categories fetched successfully", 200, {
            categories,
            page: pageInt,
            limit: limitInt,
            total: categories.length,
        });
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
};

export const createCategory = async (req, res) => {

    try {
        const findCategory = await prisma.category.findFirst({
            where: {
                name: req.body.name,
            }
        });
        if (findCategory) {
            return errorResponse(res, "Category already exists", 400);
        }
        const category = await prisma.category.create({
            data: {
                name: req.body.name,
            }
        });
        return successResponse(res, "Category created successfully", 201, category);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const deleteCategory = async (req, res) => {
    const { id } = req.params;
    const idInt = parseInt(id);
    
    try {
        const category = await prisma.category.delete({ where: { id: idInt } });
        return successResponse(res, "Category deleted successfully", 200, category);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const updateCategory = async (req, res) => {
    const { id } = req.params;
    const idInt = parseInt(id);
    const { name } = req.body;
    try {
        const category = await prisma.category.update({ where: { id: idInt }, data: { name } });
        return successResponse(res, "Category updated successfully", 200, category);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

export const getCategoryById = async (req, res) => {
    const { id } = req.params;
    const idInt = parseInt(id);
    try {
        const category = await prisma.category.findUnique({ where: { id: idInt } });
        return successResponse(res, "Category fetched successfully", 200, category);
    } catch (error) {
        return errorResponse(res, error.message, 500);
    }
}

