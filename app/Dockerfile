FROM mcr.microsoft.com/playwright:v1.63.0-jammy
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node","src/server.js"]
