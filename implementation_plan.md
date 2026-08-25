# Projeto "Respawn" - Plano de Arquitetura e Implementação

Este documento define a arquitetura técnica, as decisões de infraestrutura e o escopo exato para construir o **Respawn**, uma plataforma de comunidade para amizades e games focada em comunicação de texto, voz e vídeo de alta qualidade.

## 🎨 Branding & Identidade Visual

A identidade de **Respawn** adota uma estética gamer moderna, com sensação de neon/digital e visual limpo:
- **Cores Principais:** Preto (`#0F1115`), Grafite (`#1A1F29`), Verde neon (`#39FF88`), Roxo elétrico (`#8B5CF6`) e Branco gelo (`#F3F6FB`).
- **Tipografia:** Fonte bold, geométrica e moderna para títulos; sans-serif limpa e legível para textos.
- **Cargos Iniciais (Roles):** Novato, Player, Squadmate, Veteran, MVP, Elite, Mod, Admin.

## 🚨 User Review Required

> [!IMPORTANT]
> **Linguagem do Backend:** Para manter a velocidade de desenvolvimento alta e facilitar eventuais integrações com IA, proponho utilizarmos **Node.js com TypeScript** para a API e o servidor de WebSockets. O Discord original usa muito Go e Elixir, mas Node.js moderno dá conta perfeitamente de centenas de usuários simultâneos de forma muito eficiente. Você está de acordo com Node.js + TypeScript para o Backend, ou prefere seguir estritamente o caminho do Discord escrevendo em Go (Golang)?

> [!WARNING]
> **Infraestrutura Inicial:** Assumiremos como alvo de deploy inicial um ambiente Linux conteinerizado (Docker), idealmente hospedado na Oracle Cloud (São Paulo) ou Vultr, conforme discutido.

## ❓ Open Questions

- **Sistema de Login:** Deseja login tradicional apenas com Email e Senha, ou quer incluir opções de integração rápida (Ex: Logar com Google)?

## 🏗️ Arquitetura Proposta

### 1. Frontend (Web)
- **Framework:** React.js com TypeScript.
- **Ferramenta de Build:** Vite (Para desenvolvimento ultra-rápido).
- **Estilização:** Tailwind CSS (Permite replicar a UI complexa e o sistema de design original de forma rápida e pixel-perfect).
- **Gerenciamento de Estado:** Zustand (Extremamente rápido e mais simples que o Redux para lidar com estados de quem está online/offline).
- **Desktop Wrapper:** removido do escopo (24/08/2026, decisão do usuário). Chegou
  a ser implementado com Tauri e validado, mas foi revertido — ver `task.md`
  (Fase 4) e `QA_FASE_4_DESKTOP_TAURI.md` para o histórico. O projeto segue
  apenas como aplicação web.

### 2. Backend (APIs e Tempo Real)
- **Servidor Web:** Express.js ou Fastify (Node.js).
- **Mensageria (Tempo Real):** Socket.io (Simplifica absurdamente a resiliência da rede, reconectando o usuário automaticamente se a internet piscar).
- **ORM:** Prisma (Para gerenciar as tabelas do banco de dados com segurança máxima de tipagem).

### 3. Voz e Vídeo (Streaming)
- **Servidor WebRTC (SFU):** LiveKit. É uma solução open-source, escrita em Go (desempenho brutal) e extremamente escalável. Tem SDKs nativos e perfeitos para React.

### 4. Banco de Dados e Cache
- **Relacional Principal:** PostgreSQL (Armazena os Usuários, Servidores, Configurações, Canais).
- **Cache/Estado:** Redis (Essencial para manter na memória RAM do servidor quem está digitando ou quem entrou/saiu, sem sobrecarregar o banco principal).

## 🗂️ Estrutura de Repositórios (Monorepo)
Proponho criarmos um Monorepo gerenciado por Turborepo. Isso significa que o código do site, do backend e do app desktop viverão no mesmo lugar, compartilhando ferramentas e tipos.

### Estrutura Base
#### [NEW] `apps/web` (Frontend React)
#### [NEW] `apps/api` (Backend Node.js/WebSocket)
#### [NEW] `packages/ui` (Componentes visuais reutilizáveis - botões, modais)
#### [NEW] `packages/database` (Schema do banco e clientes de conexão)

## 🤖 AI Development Guidelines & Checkpoints (Prevenção de Alucinação)

Para evitar consumo excessivo de tokens e garantir que o código seja construído de forma controlada (sem que eu, como IA, entre em "loop" ou crie coisas além do escopo), seguiremos as seguintes regras estritas:

> A política operacional canônica para todos os agentes está em `AGENTS.md`.
> Em caso de divergência, prevalecem a separação de papéis, a cobertura por
> incremento e o gate de testes definidos naquele arquivo.

### 1. Lista Branca de Dependências (Strict Tooling)
É expressamente proibido instalar pacotes que não estejam homologados abaixo sem sua permissão. Isso evita que a IA invente bibliotecas inexistentes ou obsoletas.
- **Frontend:** `react`, `react-dom`, `typescript`, `vite`, `tailwindcss`, `zustand`, `lucide-react` (ícones), `livekit-client`, `socket.io-client`.
- **Backend:** `express` (ou fastify), `socket.io`, `prisma`, `cors`, `zod` (para validação), `jsonwebtoken`, `bcrypt`.

### 2. Sistema de Checkpoints (Stop & Verify)
A IA não emendará múltiplas tarefas de uma vez. O fluxo obrigatório de segurança será:
1. O agente implementador trabalha em **apenas um incremento pequeno** da subtarefa atual do `task.md`.
2. No mesmo incremento, cria ou atualiza o teste automatizado do comportamento e executa os testes focados.
3. Se algum teste falhar, interrompe a implementação, explica o erro e propõe a correção antes de avançar.
4. Ao concluir a funcionalidade, executa `npm run check` e entrega os resultados ao agente de QA.
5. O QA valida o handoff de forma independente e não implementa a próxima funcionalidade. Ele só assume uma correção quando o implementador não consegue resolvê-la, a falha persiste após a tentativa ou o usuário transfere explicitamente a correção.
6. O próximo passo do `task.md` só é liberado após o gate completo e a aprovação do QA.

## 🧪 Verification Plan

### Testes Manuais e de Qualidade
- **Fidelidade UI:** Comparação visual rigorosa (Side-by-side) da interface construída com o Discord real.
- **Teste de Latência de Voz:** Conectar múltiplos usuários em um servidor de teste provisório para garantir que o áudio flui sem delays notáveis.
- **Resiliência:** Desconectar intencionalmente a rede do cliente por 5 segundos e garantir que o app se reconecta e recupera as mensagens perdidas silenciosamente.

## 🖥️ Fase 4: Aplicação Desktop (Tauri) — removida do escopo

Chegou a ser implementada (Tauri instalado em `apps/web`, barra de título
customizada, `.exe` de release compilando e rodando) e validada em QA, mas
foi revertida em 24/08/2026 por decisão do usuário: a experiência desktop
pareceu instável e o usuário prefere não manter uma stack (Rust/Tauri) fora
do seu domínio de conhecimento. O projeto segue apenas como aplicação web,
com os mesmos requisitos das demais fases. Histórico completo em `task.md`
(Fase 4) e `QA_FASE_4_DESKTOP_TAURI.md`.
