# Views que não parecem humanas

API que recebe uma série de views por hora e devolve `legitimate`, `suspicious` ou `inconclusive`, com um motivo em português e os sinais que mediu. É um classificador por regras explicáveis (cinco sinais com limiar fixo), sem modelo opaco, avaliado num dataset sintético que o próprio repositório gera.

## Como rodar e testar

Node 20 ou mais novo.

```bash
npm ci
npm test            # vitest: regras, API e "número do README = número medido"
npm run typecheck   # tsc --noEmit
npm run eval        # gera o dataset, classifica tudo, imprime a matriz e grava eval-result.json
npm start           # API em http://127.0.0.1:3000 (PORT e HOST mudam isso)
npm run examples    # regrava examples/*.json a partir de src/samples.ts
```

## Resultado no dataset sintético

Saída de `npm run eval` (seed fixa `20261009`, 740 séries: 500 legítimas e 240 suspeitas):

```
rótulo \ classificado     legitimate    suspicious  inconclusive
legitimate                       498             2             0
suspicious                         7           220            13
```

- **Taxa de falso positivo** (legítimos acusados de suspeitos ÷ legítimos): <!-- fp-rate -->0,4%<!-- /fp-rate --> (2 de 500).
- **Taxa de detecção** (suspeitos acusados ÷ suspeitos): <!-- detection-rate -->91,7%<!-- /detection-rate -->.
- **Onde o classificador preferiu não acusar:** 13 suspeitos (5,4%) saíram `inconclusive`, e nenhum legítimo.
- **Quanto o número oscila só pelo sorteio:** com as seeds 1 a 10, o falso positivo ficou entre <!-- fp-range -->0,4% a 1,4%<!-- /fp-range --> e a detecção entre <!-- detection-range -->91,3% a 95,4%<!-- /detection-range -->. A seed padrão (escolhida antes de rodar) caiu na ponta boa da faixa de falso positivo.

Esses números não foram escritos à mão. `test/evaluation.test.ts` roda a avaliação, lê os marcadores `<!-- fp-rate -->`, `<!-- detection-rate -->`, `<!-- fp-range -->` e `<!-- detection-range -->` deste README e falha se o texto for diferente do medido. O mesmo arquivo de teste falha se o `eval-result.json` do repositório estiver desatualizado.

**Leia com desconto.** O dataset é sintético e foi gerado pelas mesmas hipóteses em que o classificador se apoia: gente dorme, audiência real oscila por acaso, viral decai aos poucos, robô entrega taxa constante. Além disso, ajustei os limiares olhando para este mesmo dataset (detalhes em "Por que esses limiares"). Então 0,4% é o que acontece quando o mundo se comporta como eu imaginei. Em dados reais a taxa vai ser pior, e não sei quanto. Para ter um número em que dê para confiar, é preciso rotular uma amostra real (casos confirmados de compra e criadores verificados) e rodar a mesma conta.

## API

`POST /classify`

```json
{
  "timezone": "America/Sao_Paulo",
  "series": [
    { "hour": "2026-09-11T00:00:00-03:00", "views": 66 },
    { "hour": "2026-09-11T01:00:00-03:00", "views": 50 }
  ]
}
```

- `series[].hour`: início da hora, ISO 8601 **com fuso** (`Z` ou `-03:00`). Sem fuso, "03h" seria ambíguo.
- `series[].views`: views ganhas **naquela hora** (inteiro, zero ou mais). Se você tem o contador acumulado, mande a diferença entre leituras seguidas.
- As horas têm que ser consecutivas, em ordem, sem buracos nem repetições; até 2.160 horas (90 dias). Hora sem dado não deve virar zero, porque zero parece uma queda: mande só o trecho contínuo.
- `timezone` (opcional, padrão `America/Sao_Paulo`): fuso IANA de quem assiste. Define o que é madrugada e os horários escritos no motivo.

Resposta: `classification`, `reason`, `signals[]` (cada um com `name`, `strength`, `value`, `threshold`, `firesWhen`, `fired` e `description`), mais `timezone` e `hours`. `value` é `null` quando o sinal não deu para medir; a `description` diz por quê.

### Exemplos (executados contra a API)

Os três arquivos em `examples/` são o mesmo canal (~120 views/h, 5 dias). No primeiro, um vídeo estoura de verdade. No segundo, alguém compra um pico **da mesma altura** (~11 mil/h). No terceiro, um caso ambíguo.

```bash
curl -s -X POST http://127.0.0.1:3000/classify -H 'content-type: application/json' --data @examples/pico-comprado.json
```

```json
{
  "classification": "suspicious",
  "reason": "Suspeito: 4 sinais de automação apareceram juntos. Subida em degrau: até 13/09 às 03h as views saltaram de ~39/h para 10.993/h em uma hora. Platô mecânico: de 13/09 às 04h a 13/09 às 07h (4 horas) as views ficaram quase constantes em ~10.937/h, variação de 0,6%. Audiência real oscila e vai perdendo força depois do pico. Queda abrupta: depois de 6 horas no alto, as views caíram de 10.922/h para 97/h em uma hora (13/09 às 09h), de volta ao normal do canal nesse horário (~99/h nos dias antes do pico). Sem ciclo dia/noite: 3 de 3 horas de madrugada (entre 03h e 06h, fuso America/Sao_Paulo) durante o pico ficaram no nível do topo (~10.964/h). Gente de verdade dorme: de madrugada a audiência costuma cair para uma fração do horário nobre. Audiência humana sobe e decai de forma gradual, oscila por acaso de hora em hora e cai de madrugada.",
  "signals": [
    { "name": "abrupt_rise", "strength": "supporting", "threshold": 2, "firesWhen": "<=", "value": 1, "fired": true,
      "description": "Subida em degrau: até 13/09 às 03h as views saltaram de ~39/h para 10.993/h em uma hora." },
    { "name": "flat_plateau", "strength": "strong", "threshold": 0.05, "firesWhen": "<=", "value": 0.006, "fired": true,
      "description": "Platô mecânico: de 13/09 às 04h a 13/09 às 07h (4 horas) as views ficaram quase constantes em ~10.937/h, variação de 0,6%. Audiência real oscila e vai perdendo força depois do pico." },
    { "name": "cliff_drop", "strength": "strong", "threshold": 2, "firesWhen": "<=", "value": 1, "fired": true,
      "description": "Queda abrupta: depois de 6 horas no alto, as views caíram de 10.922/h para 97/h em uma hora (13/09 às 09h), de volta ao normal do canal nesse horário (~99/h nos dias antes do pico)." },
    { "name": "mechanical_repetition", "strength": "strong", "threshold": 0.15, "firesWhen": "<=", "value": 0.78, "fired": false,
      "description": "As oscilações de hora em hora parecem acaso de audiência real: mesmo no trecho mais regular, ficaram em 0,78× o que o acaso de pessoas reais produz (repetição mecânica seria até 0,15×)." },
    { "name": "no_day_night_cycle", "strength": "strong", "threshold": 0.5, "firesWhen": ">=", "value": 1, "fired": true,
      "description": "Sem ciclo dia/noite: 3 de 3 horas de madrugada (entre 03h e 06h, fuso America/Sao_Paulo) durante o pico ficaram no nível do topo (~10.964/h). Gente de verdade dorme: de madrugada a audiência costuma cair para uma fração do horário nobre." }
  ],
  "timezone": "America/Sao_Paulo",
  "hours": 120
}
```

O pico orgânico, mesma altura, outro formato (sinais omitidos aqui; o topo variou 22,1% e a volta ao normal levou 25 horas):

```bash
curl -s -X POST http://127.0.0.1:3000/classify -H 'content-type: application/json' --data @examples/pico-organico.json
```

```json
{
  "classification": "legitimate",
  "reason": "Legítimo: nenhum sinal de automação. O pico de 13/09 às 20h (10.878/h, 87,4× o normal) levou 25 horas para voltar ao normal do canal, perdendo força aos poucos como audiência real.",
  "timezone": "America/Sao_Paulo",
  "hours": 120
}
```

Entrada inválida volta 400 com mensagem que diz o que corrigir:

```bash
curl -s -X POST http://127.0.0.1:3000/classify -H 'content-type: application/json' \
  -d '{"series":[{"hour":"2026-09-13T03:00:00-03:00","views":120},{"hour":"2026-09-13T05:00:00-03:00","views":130}]}'
```

```json
{"error":"series[1].hour precisa ser exatamente 1 hora depois de series[0].hour, mas a diferença é de 2 hora(s). Envie horas consecutivas, em ordem, sem buracos nem repetições. Hora sem dado não deve virar zero (pareceria uma queda): envie só o trecho contínuo."}
```

## O critério

### Regra de decisão (`decide` em `src/classifier.ts`)

1. Menos de 48 horas: **inconclusivo**, sempre. Sem dois dias não dá para saber o que é normal no canal.
2. Dois ou mais sinais disparados, com pelo menos um forte: **suspeito**.
3. Um sinal forte sozinho: **inconclusivo**. O classificador prefere não acusar.
4. O maior pico começa nas primeiras 12 horas da série, sem histórico antes: **inconclusivo** (não dá para medir subida nem volta ao normal).
5. Nenhum sinal forte: **legítimo**.

Quatro sinais são fortes. A subida em degrau é só de apoio: ela conta para formar o par, mas sozinha não muda nada, porque subir de uma vez é exatamente o que uma live e um vídeo que estoura fazem. Na prática, "suspeito" pede dois fortes, ou um forte junto com a subida em degrau.

### O pico

Quase todos os sinais olham para o maior pico da série:

- **Nível normal** do canal: mediana das 24 horas antes do topo.
- **Pico** existe se a maior hora for pelo menos **5×** esse normal. O ciclo do dia sozinho faz a hora mais forte ficar em ~2× a mediana, e o ruído leva a ~3×; abaixo de 5× é um dia comum.
- **Topo**: as horas seguidas em volta do máximo com pelo menos metade do máximo.

### Os sinais

| Sinal | O que mede, em palavras simples | Dispara quando | Força |
|---|---|---|---|
| `abrupt_rise` (subida em degrau) | Quantas horas as views levaram para sair do normal (até 2× o normal) e passar da metade do pico. | ≤ 2 horas | apoio |
| `flat_plateau` (platô mecânico) | Quanto as views variaram no topo, sem a primeira e a última hora (que podem ser parciais). Coeficiente de variação. Precisa de 4 horas internas. | ≤ 5% | forte |
| `cliff_drop` (queda abrupta) | Quantas horas, depois do topo, até voltar ao normal **daquele horário** (até 2× a mesma hora nos dias antes do pico). Só mede se o topo durou 3 horas ou mais. | ≤ 2 horas | forte |
| `mechanical_repetition` (repetição mecânica) | Em janelas de 8 horas com média de 100 views/h ou mais: quanto as views oscilam além da tendência, comparado com o mínimo que o acaso produz com pessoas reais (±√média). Mesmo número toda hora e mesmo incremento toda hora dão oscilação perto de zero. | ≤ 0,15× | forte |
| `no_day_night_cycle` (sem ciclo dia/noite) | Das horas entre 03h e 06h (fuso informado) que caem dentro do pico (horas seguidas acima de 3× o normal), quantas ficaram em 80% ou mais do nível do topo. Sem pico, olha a série inteira. Precisa de pelo menos 2 dessas horas. | ≥ 50% | forte |

### Por que esses limiares

- **2 horas para degrau e para queda.** Um robô liga e desliga num minuto qualquer. Em dados por hora, isso aparece numa hora só, ou em duas se ligou no meio da hora. Gente real chega por compartilhamento em cadeia (horas) e vai embora aos poucos (meia-vida de horas).
- **Queda medida contra o normal daquele horário**, e não contra a média do dia. Às 2h o normal do canal é uma fração do normal das 20h. Na primeira versão, comparando com a mediana do dia, uma live que acabava às 23h "voltava ao normal" de madrugada só porque todo mundo foi dormir, e virava falso positivo. Pela mesma razão uso o menor valor entre os dias anteriores: a subida de um viral não pode virar "normal".
- **Topo de pelo menos 3 horas para medir queda.** Pico de 1 ou 2 horas que some é o formato de um compartilhamento isolado.
- **Platô até 5%.** Painel de views entrega taxa quase constante (0,5% a 4% de variação no dataset). Audiência real no topo perde força ou oscila 10% a 30%. Comecei em 8% e tive falso positivo com viral que encontra o horário nobre: o decaimento e a subida da noite se compensam e o topo fica plano por umas horas. Em 5% esse caso fica raro, mas não some (ver falsos positivos abaixo).
- **Repetição até 0,15× do acaso.** Se N pessoas assistem de forma independente, a contagem por hora oscila pelo menos ±√N por puro acaso (Poisson); audiência real oscila mais que isso. A segunda diferença tira a tendência, então "sempre 1.000" e "sempre +150" ficam com oscilação quase zero. Comecei em 0,25, mas nas séries legítimas das seeds 1 a 5 o menor valor foi 0,20, perto demais. Abaixo de 100 views/h, números repetidos acontecem por acaso, e por isso o sinal não mede.
- **Madrugada de 03h às 06h.** É o fundo do sono, quando a audiência real costuma ser 10% a 15% da das 20h. Comecei com a madrugada inteira (00h às 06h), mas um viral que começa às 23h pode ter o topo à 1h da manhã de forma legítima, e o dataset mostrou isso.
- **48 horas mínimas, 24 horas de normal.** Um dia inteiro cobre dia e noite; o segundo dá espaço para o pico.

### O caso em que o classificador prefere não acusar

`examples/nao-acusa.json`: as views sobem aos poucos a partir das 14h (5 horas até a metade do pico), oscilam 17% no topo como gente, e somem de uma vez à meia-noite. Só a queda abrupta dispara. Pode ser robô que ligou devagar, pode ser uma live que acabou sem replay. Um sinal só não basta:

```json
{
  "classification": "inconclusive",
  "reason": "Inconclusivo: só um sinal apareceu, e um sinal sozinho não basta para acusar. Queda abrupta: depois de 6 horas no alto, as views caíram de 4.101/h para 93/h em uma hora (14/09 às 00h), de volta ao normal do canal nesse horário (~88/h nos dias antes do pico). Pode ser automação, mas também pode ter explicação real (live que acabou sem replay, audiência de outro fuso). Vale uma olhada humana ou uma série mais longa."
}
```

No dataset, isso aconteceu com 13 das 240 séries suspeitas: o classificador viu um sinal e preferiu não acusar.

### O que o classificador NÃO detecta

- **Robô que imita o ciclo do dia com ruído.** Entrega proporcional ao horário, com ±20% de variação, não forma platô, não ignora a madrugada e não repete número.
- **Compra gradual espalhada em dias.** Sem degrau, sem platô e sem queda, parece crescimento orgânico (o cenário `slow_growth` do dataset tem exatamente essa cara).
- **Fraude que acompanha engajamento real.** Robô que multiplica um viral verdadeiro herda o formato orgânico.
- **Inflação pequena.** Menos de 5× o normal nem conta como pico. Comprar +50% de views passa.
- **Picos menores que o maior.** Só o maior pico da série é analisado. Uma compra pequena na mesma semana de um viral real passa.
- **Contas pequenas** (menos de 100 views/h) para a repetição mecânica.

Os 7 suspeitos da seed padrão que passaram como legítimos mostram onde as regras falham:

- `mechanical_drip-007`, `-010` e `-054`: entrega em triângulo de 10 a 14 horas (sobe e desce com incremento fixo). Toda janela de 8 horas pega a virada ou a borda, e a repetição não aparece; a saída leva 3 horas, então também não é queda abrupta.
- `mechanical_drip-021`: rampa exata de 24 horas, mas somada a uma audiência real de ~20 views/h que já oscila ±10. O acaso da audiência real esconde a regularidade do robô.
- `step_cliff-026`: o robô saiu em rampa (nível caindo e última hora parcial), e a queda contou 3 horas.
- `step_cliff-042`: o robô desligou às 06h, quando o normal do canal sobe rápido; a primeira hora depois ainda passou de 2× o normal daquele horário, e a queda contou 3 horas.
- `night_injection-025`: robô de madrugada com ruído de ~20%. O topo "quebrou" em 3 horas acima da metade do máximo, e o resto da injeção contou como queda gradual de 5 horas.

### Falsos positivos conhecidos

- **Rajada curta de compartilhamento**: um grupo grande compartilha, o vídeo fica 3 horas no alto e some. Subida em degrau + queda abrupta. Os 2 falsos positivos da seed padrão são esse caso (`niche_noisy-010` e `niche_noisy-068`). O gerador modela a rajada como um bloco de 1 a 3 horas, o que talvez seja mais "quadrado" que a vida real.
- **Viral que encontra o horário nobre**: o topo fica plano por coincidência por 4 ou 5 horas, e a subida foi rápida (apareceu nas seeds 4 e 6). Nas outras seeds, quase todos os falsos positivos são a rajada curta acima.
- **Live que acaba e some sem replay**: degrau na entrada e queda abrupta na saída. As lives do dataset têm replay que decai, então esse falso positivo não está medido no número acima. Se a plataforma marca lives, vale passar essa informação e não acusar por esse par.

## Dataset sintético (`src/dataset.ts`)

Gerado com PRNG mulberry32 e seed fixa; cada série tem a própria seed (hash de `seed:id`), então mexer num cenário não muda os outros. Nada de `Math.random` e nada de rede. A audiência real é Poisson (pessoas independentes) sobre uma média que segue o ciclo do dia (pico às 20h–21h, vale às 4h), com ruído multiplicativo lognormal (compartilhamento vem em rajadas). Séries de 3 a 7 dias, começando à meia-noite de um dia de setembro de 2026.

| Cenário | Rótulo | Formato |
|---|---|---|
| `baseline` | legítimo | Rotina: 20 a 3.000 views/h médias, ciclo diário, ruído de 10% a 30%. |
| `organic_viral` | legítimo | Sobe em 2 a 8 horas até 10× a 100× o normal, decai com meia-vida de 3 a 36 horas, segue o ciclo do dia, deixa até 50% de seguidores novos. |
| `slow_growth` | legítimo | Cresce 2× a 8× ao longo da série. |
| `niche_noisy` | legítimo | 5 a 150 views/h, ruído de 50% a 90%, até 3 rajadas de 1 a 3 horas a 3× a 10×. |
| `live_event` | legítimo | Live entre 18h e 22h, 1 a 3 horas, a 20× a 200× o normal; replay de 20% a 60% que decai com meia-vida de 1 a 4 horas. |
| `bought_plateau` | suspeito | 5 a 14 horas a 8× a 100× o normal, variação de 0,5% a 4%, liga e desliga em qualquer minuto. |
| `step_cliff` | suspeito | 4 a 18 horas a 8× a 60×, nível deslizando até ±40%, ruído de 5% a 15%. |
| `mechanical_drip` | suspeito | Conta pequena (2 a 15 views/h) com entrega exata de 10 a 36 horas: mesmo número toda hora, rampa de incremento fixo ou triângulo. |
| `night_injection` | suspeito | Liga entre 23h e 02h, 4 a 8 horas, 5× a 40× o normal, ruído de 8% a 20%. |

100 séries por cenário legítimo e 60 por suspeito.

## Critério de avaliação → teste que cobre

| Critério | Onde |
|---|---|
| O motivo dá para ler sem conhecer o código | `test/classifier.test.ts`: "o motivo dá para ler sem conhecer o código: horários locais, números e nenhum nome interno" |
| A taxa de falso positivo do README sai do comando | `test/evaluation.test.ts`: "a taxa de falso positivo escrita no README é a que o comando de avaliação mede" (e os testes de detecção, faixa por seed e `eval-result.json`) |
| Pico orgânico plausível não cai no balde do pico comprado, e o teste mostra a diferença | `test/classifier.test.ts`: "pico orgânico plausível e pico comprado da mesma altura caem em baldes diferentes, e os sinais mostram por quê" |
| Um caso em que o classificador prefere não acusar | `test/classifier.test.ts`: "um sinal forte sozinho dá inconclusivo: o classificador prefere não acusar" |
| Casos óbvios: série curta, série plana normal | `test/classifier.test.ts`: "série curta (menos de 48 horas) é inconclusiva", "série plana normal, com ciclo de dia e noite e ruído, é legítima" |
| Subida rápida sozinha não acusa | `test/classifier.test.ts`: "subida rápida sozinha não acusa: live com replay que decai é legítima" |
| Critério documentado, inclusive o que não detecta | Este README ("O critério", "O que o classificador NÃO detecta"); `test/classifier.test.ts`: "cada sinal traz nome, valor medido, limiar, sentido do limiar e se disparou" |
| Dataset reproduzível, sem rede social real | `test/evaluation.test.ts`: "é reproduzível: a mesma seed gera exatamente as mesmas séries, e outra seed gera outras" |
| API | `test/api.test.ts`: "classifica pela API: pico comprado vem suspeito, com motivo e sinais", "rejeita série com buraco de horas, com mensagem em português que diz onde" e outros |

## Decisões e o que ficou de fora

- **Nada é guardado.** A API é uma função da série recebida, então não há repositório. Se fosse guardar as classificações para auditoria, um banco daria constraint única em (criador, vídeo, início da série, versão das regras), para não ter duas respostas para a mesma pergunta, e transação ao gravar o resultado junto com os sinais.
- **Sem relógio.** Nada depende da hora atual; tudo sai das horas da própria série. Por isso não há `Clock` injetado.
- **Só o maior pico é analisado.** Com mais tempo, eu varreria todos os picos acima de 5× e classificaria cada um.
- **Sem contexto da plataforma.** Saber que houve live, anúncio pago ou destaque na home eliminaria os falsos positivos conhecidos. Hoje o motivo cita os horários para quem revisa conferir isso.
- **Limiares fixos no código** (`RULES` em `src/classifier.ts`). Com dados reais rotulados, eu calibraria cada limiar pela taxa de falso positivo aceitável para o negócio, e não pelo meu dataset.
- **Pontos de partida para ler:** `classify` e `decide` em `src/classifier.ts`; o gerador em `src/dataset.ts`; a conta em `src/evaluate.ts`.

## Uso de IA

Feito com IA: todo o código, os testes e este texto foram escritos pelo Claude Code (modelo Claude Opus 5.5), um agente de programação, a partir do enunciado. O Thallis escolheu a abordagem de trabalho e decidiu enviar.

Revisado: cada critério de "Como avaliamos" tem um teste nomeado (tabela acima); suíte e typecheck rodados num clone limpo; os exemplos de request e response deste README foram executados contra a API; os falsos positivos e os suspeitos que passaram foram abertos um a um para escrever as seções de limites. Antes do envio, uma segunda passada de agente releu o diff contra o enunciado.
