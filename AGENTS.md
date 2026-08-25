# Política de colaboração entre agentes

Esta política vale para todo o repositório. Ela define a separação entre quem
implementa funcionalidades e quem faz a validação independente.

## Papéis

### Agente implementador

O agente que receber uma tarefa de produto ou funcionalidade é responsável por:

1. Dividir a entrega em incrementos pequenos e verificáveis.
2. Criar ou atualizar pelo menos um teste automatizado para cada comportamento
   implementado. Os testes devem ser escritos antes ou no mesmo incremento do
   código correspondente; não devem ser acumulados somente ao final.
3. Executar primeiro os testes focados do incremento.
4. Ao terminar a funcionalidade, executar a suíte completa com `npm run check`.
5. Entregar ao QA o escopo, os arquivos alterados e os resultados dos comandos.

### Agente de QA

Nesta colaboração, o Codex atua como QA e fallback de correção. Por padrão, ele:

1. Não desenvolve a próxima funcionalidade planejada.
2. Valida de forma independente o handoff do implementador, começando por
   inspeção e reprodução sem alterar o código de produção.
3. Registra cada falha com severidade, evidência, passos de reprodução,
   comportamento esperado e comportamento observado.
4. Encaminha os achados ao implementador para a primeira tentativa de correção.
5. Só modifica código de produção quando:
   - o implementador informa que não consegue resolver a falha;
   - a falha permanece após uma tentativa de correção; ou
   - o usuário pede explicitamente que o QA faça a correção.
6. Ao assumir uma correção, limita a mudança ao defeito reproduzido e cria
   primeiro (ou junto da correção) um teste de regressão que falhe sem o ajuste.
7. Não transforma uma correção em nova funcionalidade. Se a solução exigir uma
   decisão de produto ou ampliar o escopo, interrompe e pede direção ao usuário.

Subagentes iniciados pelo QA herdam o papel de QA e permanecem somente leitura,
exceto quando recebem explicitamente uma correção fallback já autorizada.

## Regra obrigatória para falhas de teste

Se qualquer teste focado ou a suíte completa falhar:

1. Interromper novas implementações e não avançar para o próximo incremento.
2. Informar o comando executado, o teste que falhou e a mensagem relevante.
3. Explicar a causa conhecida ou a hipótese sustentada pelas evidências.
4. Propor a correção antes de continuar.
5. Após corrigir, repetir o teste focado e depois `npm run check`.

Uma falha preexistente ou aparentemente não relacionada também deve ser
reportada; ela não pode ser ocultada para declarar o gate como aprovado.

## Gate de conclusão

Uma funcionalidade ou etapa só pode ser considerada concluída quando:

- cada novo comportamento possui cobertura automatizada relevante;
- todos os testes focados passam;
- `npm run check` passa integralmente;
- fluxos visuais ou de tempo real foram validados manualmente quando aplicável;
- o QA não mantém achados bloqueadores abertos;
- o relatório e o status da etapa refletem o resultado real da validação.

O agente implementador não marca a própria etapa como aprovada por QA. A
aprovação final e a atualização desse status pertencem ao agente de QA após o
gate completo.

## Comandos padrão

- API: `npm run api:test`
- Frontend: `npm run web:test`
- Gate completo: `npm run check`
- Banco/migrações: `npm run db:status`

Comandos adicionais podem ser usados conforme o risco do incremento, mas não
substituem o gate completo ao final da funcionalidade.
