# 📬 Newsletter Alunos — Disparador de WhatsApp

Escreva a newsletter uma vez, escolha os grupos e o horário, e o programa dispara
sozinho — bloco por bloco, com pausas entre as mensagens pra não parecer robô.
Acaba com o copia-e-cola diário em 6 grupos.

Tudo roda **na sua máquina**. Seus dados não saem do computador.

---

## ▶️ Como rodar (1ª vez)

1. Abra o **Terminal** e entre na pasta do projeto:
   ```bash
   cd "/Users/clararicieri/Newsletter-WhatsApp"
   ```
2. Instale (só na primeira vez):
   ```bash
   npm install --ignore-scripts
   ```
3. Ligue o programa:
   ```bash
   npm start
   ```
4. Abra no navegador: **http://localhost:3000**
5. Na aba **Conexão**, clique em *Conectar WhatsApp* e escaneie o QR Code:
   no celular → **Configurações → Aparelhos conectados → Conectar um aparelho**.

Pronto. A conexão fica salva — nas próximas vezes basta `npm start` e ele já volta conectado.

---

## 📝 Uso no dia a dia

- **Nova Newsletter**: cole o texto. Separe cada bloco (cada mensagem do WhatsApp)
  com uma linha contendo só `---`. O contador mostra quantos blocos vão sair.
- Marque os **grupos** que recebem.
- Defina **data e horário** do disparo (pode deixar a semana toda agendada).
- Marque *Repetir todo dia* se a mensagem do horário for sempre no mesmo horário.
- **Agendadas**: acompanhe o status, dispare na hora (*Disparar agora*) ou exclua.

---

## ⚠️ Importante: o Mac não pode dormir na hora do disparo

Como roda no seu computador, ele precisa estar **ligado e acordado** no horário agendado.
Se a tela dormir, o macOS pausa o programa e o disparo não acontece.

**Solução fácil:** antes do horário, abra outro Terminal e rode:
```bash
caffeinate -i -t 7200
```
Isso impede o Mac de dormir por 2 horas (7200 segundos). Ajuste o número se precisar.
Ou, em *Ajustes do Sistema → Bloqueio de tela*, deixe "Desligar o monitor" como *Nunca*
enquanto estiver usando.

---

## 🛡️ Sobre risco de bloqueio

Disparar a mesma mensagem pra vários grupos é o padrão que o WhatsApp usa pra detectar
bots. O risco com **6 grupos, 1x por dia** é baixo, mas existe. Por isso o programa:

- manda **bloco por bloco** com pausa aleatória entre cada mensagem;
- espera mais tempo (30–75s) **entre um grupo e o próximo**;
- nunca dispara tudo de uma vez.

Você pode ajustar esses tempos na aba **Ajustes**. Quanto maiores as pausas, mais seguro
(e mais demorado). Os valores padrão são um bom equilíbrio.

---

## 🔧 Detalhes técnicos

- **Node.js + Express** (servidor + interface num processo só)
- **Baileys** para a conexão com o WhatsApp (aparelho vinculado, igual ao WhatsApp Web)
- Dados guardados localmente em `data/db.json`; sessão do WhatsApp em `data/auth/`
- Sem banco de dados externo, sem nuvem
