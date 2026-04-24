FROM mcr.microsoft.com/playwright:v1.55.0-jammy

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Cloud Run provides $PORT (usually 8080)
ENV PORT=8080

EXPOSE 8080

CMD ["npm","start"]
