# Respawn

O **Respawn** é uma plataforma de comunidade completa, projetada para gerenciar canais, mensagens e membros, com foco em escalabilidade e performance.

Este projeto é um monorepo construído utilizando **NPM Workspaces** e **TypeScript**, dividindo a aplicação entre serviços de backend (API), aplicação frontend (Web) e pacotes compartilhados (Banco de Dados e UI).

## Requisitos

- Node.js 24 ou superior
- NPM 11 ou superior
- Docker Desktop com Docker Compose

## Comandos

```bash
npm install
npm run check
```

`npm run check` executa a checagem de tipos de todos os workspaces e gera os artefatos de build em `dist/`.

## Banco de dados local

Com o Docker Desktop em execução:

```bash
npm run db:up
npm run db:migrate
```

O PostgreSQL fica disponível somente em `127.0.0.1:5432`. As credenciais padrão são exclusivas para desenvolvimento e podem ser sobrescritas copiando `.env.example` para `.env`.

Comandos úteis:

```bash
npm run db:status
npm run db:down
```

## Frontend

Com a API em execução, inicie o Vite em outro terminal:

```bash
npm run web:dev
```

Abra `http://localhost:5173`. As páginas ficam disponíveis em `/login` e
`/register`. Durante o desenvolvimento, requisições para `/api` são encaminhadas
para `http://127.0.0.1:3001` pelo Vite.

Para usar uma API hospedada separadamente, copie `apps/web/.env.example` para
`apps/web/.env` e preencha `VITE_API_URL` antes de gerar o bundle. O token fica
no `sessionStorage`: um refresh na mesma aba restaura a sessão, enquanto fechar
a aba encerra o acesso local. O botão de saída limpa o token local; a revogação
no servidor será adicionada quando a API ganhar uma rota de logout.

Depois da autenticação, a aplicação abre o layout demonstrativo da comunidade em
`/channels/respawn-hq/spawn-point`. A troca de canal usa a History API do
navegador, mantém os botões voltar/avançar funcionais e não recarrega a página.
Servidores, canais, mensagens, membros, presença e o envio no composer são mocks
locais desta fase; chat em tempo real e voz entram nas fases seguintes.

Em hospedagem estática, configure o servidor para reescrever
`/channels/*` para `index.html`, preservando o acesso direto aos deep links.

## API de autenticação

Copie `.env.example` para `.env`, gere um `JWT_SECRET` aleatório e execute:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
npm run api:start
```

Rotas disponíveis:

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session` com `Authorization: Bearer <token>`

Antes de expor a API publicamente, aplique rate limiting no proxy ou em uma camada compartilhada com Redis e adicione confirmação de propriedade do email.

## Estrutura

```text
apps/
  api/       API Node.js
  web/       aplicação React
packages/
  database/  schema e cliente do banco de dados
  ui/        componentes visuais compartilhados
```
