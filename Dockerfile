# syntax=docker/dockerfile:1

# Comments are provided throughout this file to help you get started.
# If you need more help, visit the Dockerfile reference guide at
# https://docs.docker.com/go/dockerfile-reference/

# Want to help us make this template better? Share your feedback here: https://forms.gle/ybq9Krt8jtBL3iCk7

ARG NODE_VERSION=18.20.4

FROM node:${NODE_VERSION}-alpine

# Use production node environment by default.
ENV NODE_ENV production

# Install dependencies untuk canvas
RUN apk add --no-cache \
    build-base \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    python3 \
    make \
    pkgconfig

WORKDIR /usr/src/app

# Copy package files dan prisma schema
COPY package*.json ./
COPY prisma ./prisma/

# Install dependencies
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# Generate Prisma Client
RUN npx prisma generate

# Copy the rest of the source files into the image.
COPY . .

# Run the application as a non-root user.
USER node

# Expose the port that the application listens on.
EXPOSE 3000

# Run the application.
CMD npm start
