# Usa una imagen ligera de Node
FROM node:20-alpine

# Crea el directorio de trabajo
WORKDIR /app

# Copia los archivos de dependencias primero (para aprovechar caché)
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto del código
COPY . .

# Expone el puerto que usaremos (coincide con PORT=8082 en el .env)
EXPOSE 8082

# Comando para iniciar (asegúrate de tener "start" en tu package.json)
CMD ["npm", "start"]
