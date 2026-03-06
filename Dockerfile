FROM node:22-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc

COPY WORKFLOW.md ./

EXPOSE 3000

CMD ["node", "dist/index.js"]
