#!/bin/bash

# Buat direktori uploads dan subdirektorinya
mkdir -p /app/uploads/audio
mkdir -p /app/uploads/audios
mkdir -p /app/uploads/avatars
mkdir -p /app/uploads/covers
mkdir -p /app/uploads/events
mkdir -p /app/uploads/processed
mkdir -p /app/uploads/waiting-process

# Set permission yang tepat
chmod -R 777 /app/uploads

# Jalankan aplikasi
exec npm start 