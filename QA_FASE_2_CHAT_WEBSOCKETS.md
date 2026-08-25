# Relatório de QA — Fase 2: Motor de Chat e Tempo Real

**Projeto:** Respawn  
**Data da validação:** 24/08/2026  
**Responsável pelo parecer:** QA Codex  
**Escopo de referência:** task.md, linhas 21–31  
**Resultado da rodada original:** **REPROVADA / NÃO LIBERAR A FASE 3**  
**Resultado da revalidação final (24/08/2026):** **APROVADA / FASE 3 LIBERADA**

---

> As seções 1–9 preservam o diagnóstico da rodada original. A situação atual,
> as correções e as evidências finais estão consolidadas na seção 10.

## 1. Resumo executivo

A implementação atende aos fluxos felizes de autenticação do WebSocket, envio e
recebimento de mensagens, Markdown, agrupamento, paginação e presença. Entretanto,
foram identificadas falhas bloqueadoras de segurança, reconexão e consistência de
estado.

O defeito mais grave permite que um usuário autenticado derrube o processo da API
enviando um argumento de acknowledgement inesperado. Também há perda de
sincronização após reconexão, condições de corrida capazes de fazer mensagens
desaparecerem e estados de presença/digitação que permanecem incorretos.

Os itens da Fase 2 não devem permanecer marcados como concluídos até que os
defeitos P0/P1 deste relatório sejam corrigidos e cobertos por testes automatizados.

### Contagem dos achados

| Prioridade | Quantidade | Interpretação |
|---|---:|---|
| P0 / Crítica | 1 | Pode derrubar a API |
| P1 / Alta | 6 | Quebra tempo real, consistência ou segurança |
| P2 / Média | 4 | Viola critério de aceite ou causa UX enganosa |
| P3 / Baixa | 1 | Cobertura automatizada e higiene do projeto |

---

## 2. Escopo validado

Critérios extraídos de **task.md:21–31**:

1. WebSocket configurado e restrito a usuários autenticados.
2. Envio e recebimento imediato de mensagens sem recarregar.
3. Agrupamento de mensagens sequenciais do mesmo usuário.
4. Markdown básico: negrito, itálico e código.
5. Histórico infinito ao rolar para cima.
6. Scroll sempre preso à base ao receber nova mensagem.
7. Indicadores online/offline na lista de membros.
8. Indicador em tempo real de usuário digitando.

Não existe um commit isolado para a Fase 2. A implementação está no working tree
local sobre o único commit do repositório, **3e72bd7 — Commit inicial**.

---

## 3. Ambiente e métodos de teste

### Ambiente

- Windows
- Node.js 24+
- npm 11+
- PostgreSQL local em 127.0.0.1:5432
- Brave/Chromium
- Viewports validados: 1440×900, viewport padrão e 375×812
- Docker CLI indisponível, mas o banco estava acessível

### Comandos executados

- npm run check
- npm run typecheck
- npm run api:test
- npm run db:status
- build e smoke HTTP do frontend
- harness REST + Socket.IO
- testes funcionais com duas sessões reais no navegador

### Resultado dos checks

| Check | Resultado | Observação |
|---|---|---|
| Prisma generate/validate | Aprovado | Migrações em dia |
| TypeScript | Aprovado | Todos os workspaces |
| Build Vite | Aprovado | Bundle gerado |
| Testes existentes da API | Aprovado | Apenas 1 teste de autenticação |
| Harness chat/Socket.IO | 18/19 | Falha na limpeza de typing ao desconectar |
| Smoke HTTP | Aprovado | Rotas e assets principais retornaram 200 |
| Desktop/mobile | Aprovado no fluxo feliz | Drawer mobile e lista de membros funcionais |

---

## 4. Matriz de critérios de aceite

| Critério | Status | Evidência |
|---|---|---|
| WebSocket autenticado | Parcial | Handshake funciona, mas a sessão não é revalidada depois |
| Mensagens imediatas | Reprovado | Quebra após reconexão e em condições de corrida |
| Agrupamento sequencial | Aprovado | Duas mensagens geraram dois articles e apenas um cabeçalho de autor |
| Markdown básico | Aprovado | strong, em e code renderizados corretamente |
| Histórico infinito | Parcial | Paginação 50 → 56 funcionou; existe corrida de sobrescrita |
| Scroll sempre na base | Reprovado | Implementação usa limiar de 160 px |
| Presença online/offline | Parcial | Fluxo normal funciona; existe presença fantasma |
| Usuário digitando | Reprovado | Indicador fica preso após desconexão |

---

## 5. Defeitos detalhados

### QA-F2-001 — Callback Socket.IO inválido pode derrubar a API

**Prioridade:** P0  
**Severidade:** Crítica  
**Arquivos:** apps/api/src/modules/chat/chat.gateway.ts:137–169

#### Descrição

Os handlers tratam o segundo argumento como função de acknowledgement e executam
ack?.(...). Optional chaining verifica apenas se o valor é nulo ou indefinido; ele
não verifica se o valor recebido é realmente uma função.

Um cliente autenticado pode emitir um evento com uma string, objeto ou número no
lugar do callback e provocar TypeError não tratado.

#### Reprodução

1. Registrar/login e conectar ao Socket.IO com token válido.
2. Emitir channel:join ou message:send.
3. Informar um segundo argumento que não seja função.
4. Observar TypeError: ack is not a function e encerramento do processo.

#### Esperado

Payload e callback inválidos devem ser ignorados ou rejeitados sem afetar o
processo e sem interromper outros clientes.

#### Atual

O erro escapa do handler e pode finalizar a API.

#### Correção sugerida

- Criar helper único para responder acknowledgements somente quando
  typeof ack === "function".
- Não confiar nos tipos TypeScript para valores vindos da rede.
- Garantir captura de erros síncronos e assíncronos em todos os handlers.
- Adicionar teste que envie undefined, string, objeto, número e função válida.

Exemplo conceitual:

~~~ts
function reply(ack: unknown, payload: AckResponse): void {
  if (typeof ack === "function") {
    ack(payload);
  }
}
~~~

#### Teste de regressão obrigatório

O processo deve continuar respondendo após cada formato de acknowledgement
inválido e um segundo cliente deve continuar conseguindo enviar mensagens.

---

### QA-F2-002 — Cliente não entra novamente na sala após reconexão

**Prioridade:** P1  
**Severidade:** Alta  
**Arquivos:** apps/web/src/layouts/MainLayout.tsx:85–129

#### Descrição

channel:join é enviado apenas quando channelId muda. Salas Socket.IO são perdidas
quando uma conexão cai e um novo socket é estabelecido. Como channelId não muda na
reconexão, o cliente não volta à sala ativa.

#### Reprodução validada no navegador

1. Entrar em spawn-point.
2. Confirmar envio normal.
3. Reiniciar de fato a API.
4. Aguardar a reconexão automática.
5. Enviar mensagem sem trocar de canal.
6. O campo é limpo e há anúncio de sucesso.
7. A mensagem não aparece na tela.
8. Recarregar a página; a mensagem aparece no histórico.

No teste, a contagem visual permaneceu em 58 articles após o envio e só foi
atualizada depois do reload.

#### Esperado

Ao reconectar, o cliente deve:

1. entrar novamente no canal ativo;
2. sincronizar presença;
3. limpar estados transitórios de typing;
4. buscar mensagens que possam ter sido perdidas durante a queda.

#### Atual

O envio é persistido e recebe ACK, mas o próprio remetente deixa de receber
message:new e mensagens de terceiros da sala.

#### Correção sugerida

- Registrar socket.on("connect", ...) e executar join do canal ativo em toda
  conexão/reconexão.
- Rebuscar a última página ou sincronizar a partir do último ID conhecido.
- Expor estado connecting/reconnecting/connected na UI.
- Não anunciar sucesso antes de confirmar persistência e atualização local.
- Considerar um hook dedicado para o ciclo de vida do chat.

#### Teste de regressão obrigatório

Duas sessões devem continuar trocando mensagens após queda e retorno da API, sem
trocar de canal e sem reload.

---

### QA-F2-003 — Resposta do histórico pode apagar mensagem recebida em tempo real

**Prioridade:** P1  
**Severidade:** Alta  
**Arquivo:** apps/web/src/stores/chat-store.ts:33–58 e 102–116

#### Descrição

loadInitialMessages substitui messagesByChannel[channelSlug] pelo array recebido
da API. Se message:new chegar enquanto o fetch está em andamento, receiveMessage
adiciona a mensagem ao store, mas a resposta HTTP posterior sobrescreve o array e
remove a mensagem.

O early return quando o canal já possui um array também impede ressincronização
depois de reconexão ou relogin.

#### Reprodução sugerida

1. Adicionar atraso controlado à rota de histórico.
2. Abrir um canal, iniciando o fetch.
3. Enviar uma mensagem por outra sessão antes da resposta HTTP.
4. Confirmar que message:new aparece.
5. Liberar a resposta HTTP.
6. Observar a mensagem desaparecer.

#### Correção sugerida

- Mesclar histórico e mensagens atuais por ID, em vez de substituir.
- Ordenar o resultado final por createdAt + id.
- Usar request ID/geração por canal para ignorar respostas obsoletas.
- Disponibilizar refresh/resync explícito após reconexão.

#### Teste de regressão obrigatório

Uma mensagem recebida durante o fetch deve permanecer no store após a resolução
do histórico e não pode ser duplicada.

---

### QA-F2-004 — Corrida gera usuário fantasma na presença

**Prioridade:** P1  
**Severidade:** Alta  
**Arquivo:** apps/api/src/modules/chat/chat.gateway.ts:113–135 e 202–210

#### Descrição

presence.add ocorre somente depois de ensureMembership resolver. Se o socket
desconectar antes disso, disconnect tenta remover uma presença que ainda não foi
adicionada. Quando a Promise resolve, o código adiciona o socket já desconectado,
deixando o usuário online indefinidamente.

#### Esperado

Um socket desconectado nunca deve ser adicionado ao tracker.

#### Correção sugerida

- Após await ensureMembership, verificar socket.connected antes de presence.add.
- Registrar handlers e presença em uma sequência atômica.
- Manter cleanup idempotente.
- Testar membership atrasada artificialmente com desconexão antecipada.

---

### QA-F2-005 — Indicador de digitação permanece preso após desconexão

**Prioridade:** P1  
**Severidade:** Alta  
**Arquivos:** apps/api/src/modules/chat/chat.gateway.ts:172–210 e apps/web/src/stores/chat-store.ts:119–131

#### Reprodução validada

1. Abrir duas sessões no mesmo canal.
2. Digitar na sessão B.
3. Confirmar o indicador na sessão A.
4. Fechar B antes do debounce de 2 segundos.
5. Aguardar mais de 3 segundos.
6. O indicador continua visível em A.

#### Causa

O servidor emite typing:false apenas quando recebe typing:stop. disconnect trata
somente presença, e o frontend não aplica TTL aos estados de digitação.

#### Correção sugerida

- Rastrear canais em que cada socket está digitando.
- Emitir typing:false no evento disconnecting/disconnect.
- Emitir stop ao trocar/sair de canal.
- Aplicar TTL defensivo de aproximadamente 3–5 segundos no frontend.

#### Teste de regressão obrigatório

O indicador deve desaparecer quando ocorrer typing:stop, timeout, troca de canal,
logout, queda de rede ou fechamento abrupto da aba.

---

### QA-F2-006 — Socket permanece autorizado após expiração ou revogação

**Prioridade:** P1  
**Severidade:** Alta  
**Arquivo:** apps/api/src/modules/chat/chat.gateway.ts:89–111 e 149–199

#### Descrição

A sessão é validada somente no handshake. Depois disso, os handlers reutilizam o
usuário salvo em socket.data sem verificar se a sessão expirou ou foi revogada.

#### Risco

Um socket conectado pode continuar enviando mensagens e eventos depois de logout,
revogação administrativa ou expiração do token.

#### Correção sugerida

- Guardar sessionId/expiresAt no socket.
- Agendar disconnect na expiração.
- Revalidar a sessão em eventos que alteram estado, pelo menos message:send.
- Propagar revogação/logout para encerrar sockets associados.

#### Teste de regressão obrigatório

Revogar a sessão e confirmar que o mesmo socket deixa de enviar mensagens sem
precisar desconectar voluntariamente.

---

### QA-F2-007 — Bootstrap concorrente pode duplicar servidor e canais

**Prioridade:** P1  
**Severidade:** Alta  
**Arquivos:** apps/api/src/modules/chat/chat.service.ts:67–103 e packages/database/prisma/schema.prisma

#### Descrição

cachedServerId não sincroniza chamadas simultâneas. Duas primeiras conexões podem
executar findFirst antes de qualquer create terminar e criar dois Respawn HQ.

Os canais também usam findFirst + create sem constraint única em serverId + name.
Em múltiplos processos/instâncias, o cache em memória não oferece proteção.

#### Correção sugerida

- Criar identificador estável e único para o servidor padrão, por exemplo slug.
- Adicionar @@unique([serverId, name]) ou slug equivalente aos canais.
- Provisionar servidor/canais por migration/seed idempotente.
- Usar upsert/transaction apoiados por constraints do banco.
- Tratar P2002 buscando o registro vencedor.

#### Teste de regressão obrigatório

Executar dezenas de chamadas ensureMembership concorrentes e confirmar exatamente
um servidor padrão e um canal de cada definição.

---

### QA-F2-008 — Autoscroll não atende ao critério escrito

**Prioridade:** P2  
**Severidade:** Média  
**Arquivos:** task.md:28 e apps/web/src/components/community/ChatPanel.tsx:193–219

#### Evidência dinâmica

Com o usuário afastado da base:

- antes da mensagem: scrollTop 182, distância da base 931;
- depois da mensagem: scrollTop 182, distância da base 999.

O código só rola se a distância estiver abaixo de 160 px.

#### Decisão necessária

Há duas opções válidas, mas task e implementação precisam concordar:

1. **Critério literal:** sempre rolar para a base ao receber mensagem.
2. **UX inteligente:** rolar apenas se o usuário já estava próximo da base e
   mostrar botão/contador de novas mensagens quando estiver lendo o histórico.

Se a opção 2 for a desejada, atualizar task.md e calcular a proximidade antes do
append.

---

### QA-F2-009 — Campo é limpo e sucesso anunciado antes do ACK

**Prioridade:** P2  
**Severidade:** Média  
**Arquivos:** apps/web/src/layouts/MainLayout.tsx:140–148 e apps/web/src/components/community/ChatPanel.tsx:245–255

#### Descrição

sendChatMessage retorna Promise, mas MainLayout a descarta com void. ChatPanel
limpa o draft e anuncia sucesso imediatamente.

Em send_failed, timeout, desconexão ou sessão inválida, o usuário perde o texto e
recebe feedback incorreto.

#### Correção sugerida

- onSendMessage deve retornar Promise.
- Aguardar ACK com timeout.
- Limpar o draft somente após sucesso.
- Preservar conteúdo e exibir erro acionável em falha.
- Bloquear envios duplicados enquanto estiver pendente.
- Opcionalmente usar mensagem otimista com estados pending/sent/failed.

---

### QA-F2-010 — Encerramento normal pode terminar com exit code 1

**Prioridade:** P2  
**Severidade:** Média  
**Arquivo:** apps/api/src/server.ts:30–47

#### Descrição

io.close fecha o servidor HTTP associado. A chamada seguinte de server.close pode
receber ERR_SERVER_NOT_RUNNING, levando process.exitCode a 1 mesmo em SIGINT ou
SIGTERM normal.

#### Correção sugerida

- Definir uma única autoridade para fechar o HTTP server.
- Desconectar Socket.IO, fechar HTTP e Prisma em ordem, sem fechar o mesmo recurso
  duas vezes.
- Adicionar teste de processo que envia SIGTERM e espera exit code 0.

---

### QA-F2-011 — Contadores reais e demonstrativos são contraditórios

**Prioridade:** P2  
**Severidade:** Média  
**Arquivo:** apps/web/src/components/community/ChannelSidebar.tsx:78–86 e 150–157

#### Descrição

Durante o teste, o header e a lista de membros exibiam 1 online, enquanto a lateral
exibia 7 online, Dados demonstrativos e Online — simulação visual.

#### Correção sugerida

- Remover indicadores demonstrativos quando os dados reais estiverem disponíveis.
- Reutilizar onlineUserIds.size em todas as superfícies.
- Remover unreadCount mockado ou rotulá-lo de modo inequívoco fora do produto.

---

### QA-F2-012 — Ausência de cobertura automatizada da Fase 2

**Prioridade:** P3  
**Severidade:** Baixa, com alto risco de regressão  
**Arquivos:** apps/api/package.json e apps/web/package.json

O único teste versionado executado pela API é auth.e2e.test. Não existem testes de
chat, Socket.IO, store ou componentes do frontend. Também não há lint configurado.

#### Suíte mínima recomendada

1. Handshake sem token, token inválido, expirado e revogado.
2. Payload e acknowledgement malformados.
3. Join/rejoin após reconexão.
4. Broadcast entre duas sessões.
5. ACK de sucesso e erro.
6. Cursor do histórico e deduplicação.
7. Mensagem recebida durante fetch.
8. Presença com múltiplas abas.
9. Desconexão antes de ensureMembership resolver.
10. Typing stop, timeout, troca de canal e disconnect.
11. Bootstrap concorrente.
12. Shutdown com exit code 0.
13. Componentes de Markdown, agrupamento, erro de envio e autoscroll.

---

## 6. Ordem recomendada de implementação

### Bloco 1 — P0

1. Validar callback de ACK.
2. Adicionar testes de payloads hostis.
3. Garantir que nenhum erro de handler encerre o processo.

### Bloco 2 — Confiabilidade do tempo real

1. Rejoin e resync após reconexão.
2. Merge/deduplicação do histórico com eventos WS.
3. Cleanup correto de presença e typing.
4. Tratamento assíncrono do envio no frontend.

### Bloco 3 — Segurança e concorrência

1. Revalidação/expiração de sessão em sockets ativos.
2. Bootstrap idempotente apoiado por constraints do PostgreSQL.
3. Testes concorrentes e de revogação.

### Bloco 4 — UX e operação

1. Definir comportamento oficial do autoscroll.
2. Remover contadores demonstrativos.
3. Corrigir shutdown.
4. Atualizar README e checklist.

---

## 7. Definition of Done para nova rodada de QA

A Fase 2 poderá ser aprovada quando:

- QA-F2-001 a QA-F2-007 estiverem corrigidos.
- Não houver crash com entrada de rede malformada.
- Duas sessões continuarem sincronizadas após reinício da API.
- Nenhuma mensagem desaparecer durante fetch/reconexão.
- Presença e typing forem limpos em todas as formas de desconexão.
- Sessão revogada perder acesso ao socket.
- Bootstrap concorrente produzir uma única estrutura padrão.
- O comportamento do autoscroll estiver alinhado com task.md.
- Falhas de envio preservarem o texto e exibirem erro.
- A suíte automatizada cobrir os cenários críticos.
- npm run check e npm run api:test passarem.
- Uma rodada manual desktop e mobile passar sem contadores contraditórios.

---

## 8. Evidências de fluxo feliz

Durante a validação foram confirmados:

- dois usuários conectados simultaneamente;
- presença variando de 1 para 2 e retornando a 1;
- mensagem recebida imediatamente por outra sessão;
- negrito, itálico e código renderizados como elementos semânticos;
- duas mensagens sequenciais agrupadas sob um único cabeçalho de autor;
- carregamento inicial de 50 mensagens;
- scroll ao topo expandindo o histórico de 50 para 56 mensagens;
- lista de membros e status no desktop;
- drawer de membros funcional em 375×812;
- build e typecheck sem erro.

Esses resultados confirmam que a base da funcionalidade existe, mas não eliminam
os bloqueadores descritos.

---

## 9. Cleanup e integridade do workspace

- Duas contas descartáveis de QA foram removidas.
- Cinquenta e nove mensagens de teste foram removidas.
- Sessões e memberships correspondentes foram removidas por cascade.
- Serviços locais iniciados para a validação foram desligados.
- Nenhum arquivo de implementação foi alterado durante a rodada de QA.
- Este relatório é a única alteração adicionada por solicitação do usuário.

---

## 10. Revalidação final e encerramento

### Parecer

**APROVADA.** Os defeitos bloqueadores e as condições de corrida descritas neste
relatório foram corrigidos e cobertos por testes. A Fase 2 atende aos critérios de
aceite atuais e pode avançar para a Fase 3.

### Gate automatizado final

| Check | Resultado final |
|---|---|
| Build de produção | Aprovado — 1.859 módulos |
| TypeScript | Aprovado em todos os workspaces |
| Prisma generate/validate/status | Aprovado — 4 migrações em dia |
| API REST + Socket.IO | 23/23 testes aprovados |
| Frontend Vitest | 45/45 testes aprovados |
| `git diff --check` | Aprovado |

### Evidências funcionais finais

- Duas sessões reais conectaram simultaneamente, com presença 1 → 2 → 1.
- `typing:start/stop` apareceu e foi removido corretamente; eventos efêmeros não
  ficam no buffer para replay após reconexão.
- Mensagem foi entregue em tempo real e Markdown foi renderizado semanticamente.
- Rascunho com espaços finais foi limpo somente depois do ACK.
- Canais de voz não exibem nem aceitam composer de texto.
- Após reinício real da API, mensagem perdida em canal inativo apareceu ao
  reabrir o canal via resync, sem reload.
- Envio tentado offline exibiu erro, preservou o rascunho e não foi persistido
  nem reproduzido depois da reconexão.
- Logout pela interface marcou `revokedAt`, removeu o acesso local e manteve uma
  segunda sessão independente ativa.
- Layout 375×812 ocultou as laterais desktop e expôs os dois drawers móveis.

### Robustez acrescentada

- ACKs hostis não derrubam o processo.
- Revogação, expiração, `channel:join`, typing e `message:send` compartilham uma
  ordem explícita por sessão.
- Retry com `clientMessageId` é idempotente, detecta conflito de canal/conteúdo e
  gera somente uma linha/um broadcast mesmo sob concorrência.
- Respostas HTTP obsoletas não sobrescrevem loading, erro ou status de uma
  sincronização nova; merges continuam deduplicados por ID.
- Presença e typing são agregados corretamente quando o mesmo usuário possui
  múltiplos sockets.

### Limite arquitetural conhecido

O coordenador de revogação/ordenação usa memória e `EventEmitter` do processo
Node atual. Isso é adequado ao deployment single-process validado nesta fase. Ao
escalar horizontalmente, será necessário substituir essa invariante por pub/sub
compartilhado e lock transacional/distribuído entre réplicas.

### Cleanup da revalidação

- 2 contas descartáveis e 3 mensagens válidas de QA removidas.
- A tentativa offline não gerou linha no banco.
- Viewport do navegador restaurado e serviços locais iniciados pelo QA desligados.
