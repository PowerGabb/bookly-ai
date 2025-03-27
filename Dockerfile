FROM node:18-slim

# Install dependencies untuk canvas
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    pkg-config \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies dan rebuild canvas
RUN npm install
RUN npm rebuild canvas --update-binary

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Buat script init.sh executable
RUN chmod +x /app/init.sh

# Buat direktori uploads dan subdirektorinya
RUN mkdir -p /app/uploads/covers /app/uploads/waiting-process

# Set permission yang tepat
RUN chmod -R 777 /app/uploads

EXPOSE 3000

CMD ["/app/init.sh"] 