import { LegalPage, type LegalSection } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: `Política de Privacidade — ${LEGAL.product}` };

const SECTIONS: LegalSection[] = [
  {
    title: "Quem trata os seus dados",
    body: [`O ${LEGAL.product} é operado por ${LEGAL.company}, CNPJ ${LEGAL.cnpj}, com sede em ${LEGAL.address} ("nós"). Somos o controlador dos dados pessoais descritos aqui, nos termos da Lei Geral de Proteção de Dados (Lei 13.709/2018).`, `Encarregado pelo tratamento de dados: ${LEGAL.dpo}. Contato geral: ${LEGAL.email}.`],
  },
  {
    title: "O seu vídeo fica no seu navegador",
    body: [
      "O arquivo de vídeo que você envia não é transmitido aos nossos servidores. Ele fica guardado no armazenamento do seu navegador, e a prévia e a exportação acontecem no seu próprio aparelho.",
      "O que sai do seu aparelho, e só quando você usa o recurso correspondente:",
      [
        "Áudio da fala, comprimido, enviado para transcrição quando você pede legendas, limpeza por fala ou edição pela IA.",
        "O texto da transcrição, medidas do vídeo (pausas, movimento, posição do rosto no quadro) e alguns quadros em baixa resolução, enviados ao modelo de IA quando você pede uma edição.",
        "Capturas reduzidas do vídeo já editado, usadas pela revisão automática ao fim de uma edição completa.",
        "A descrição de uma imagem ou vídeo que você aceita gerar por IA.",
        "O endereço de um vídeo de referência que você informa, e alguns quadros de um arquivo de referência que você envia.",
      ],
    ],
  },
  {
    title: "Dados que guardamos",
    body: [
      [
        "Cadastro: nome, e-mail e senha (guardada apenas como hash). Se você entra com Google, recebemos nome, e-mail e o identificador da sua conta Google.",
        "Projetos: a edição de cada vídeo (cortes, legendas, textos, a transcrição da fala e as medidas do vídeo), para você continuar de onde parou em qualquer aparelho. O arquivo de vídeo não faz parte disso.",
        "Brand Kits: cores, fontes, nome, credencial e vocabulário que você cadastra.",
        "Uso e cobrança: saldo e histórico de créditos, pedidos feitos à IA com o custo de cada um, plano e situação da assinatura. Os dados do cartão ficam com o processador de pagamentos; não os recebemos.",
        "Segurança: endereço IP em contadores temporários que limitam tentativas de login e cadastro, e um cookie de sessão.",
      ],
    ],
  },
  {
    title: "Para que usamos e com que base legal",
    body: [
      [
        "Prestar o serviço que você contratou: criar a conta, editar, salvar projetos, cobrar (execução de contrato).",
        "Proteger a plataforma contra fraude e abuso, e medir o custo de operação (legítimo interesse).",
        "Cumprir obrigações fiscais e legais (obrigação legal).",
        "Enviar e-mails de confirmação de cadastro e de recuperação de senha (execução de contrato).",
      ],
      "Não usamos o seu conteúdo para treinar modelos de IA nossos e não vendemos os seus dados.",
    ],
  },
  {
    title: "Com quem compartilhamos",
    body: [
      "Contratamos fornecedores que processam dados em nosso nome, apenas para a finalidade indicada:",
      [
        "Groq: transcrição do áudio da fala.",
        "Anthropic e Google (Gemini): modelos de IA que planejam e montam a edição a partir da transcrição, das medidas e dos quadros; o Google também gera as imagens e os vídeos que você pede.",
        "Stripe: pagamentos, assinaturas e notas de cobrança.",
        "Resend: envio dos e-mails transacionais.",
        "Pexels e Pixabay: busca de imagens e vídeos de banco (recebem apenas o termo pesquisado).",
        "Google: login com a conta Google, quando você escolhe essa forma de entrar.",
        "Provedores de hospedagem e de banco de dados onde a aplicação roda.",
      ],
      "Alguns desses fornecedores ficam fora do Brasil, em especial nos Estados Unidos. A transferência internacional acontece para executar o serviço que você pediu, com as garantias contratuais que cada fornecedor oferece.",
    ],
  },
  {
    title: "Cookies",
    body: ["Usamos apenas um cookie de sessão, necessário para manter você conectado, e armazenamento local do navegador para guardar o vídeo, o projeto aberto e preferências do editor. Não usamos cookies de publicidade nem de rastreamento de terceiros."],
  },
  {
    title: "Por quanto tempo guardamos",
    body: [
      [
        "Conta, projetos e Brand Kits: enquanto a conta existir. Você pode apagar um projeto a qualquer momento na lista de projetos.",
        "Registros de cobrança e de uso: pelo prazo exigido pela legislação fiscal e para defesa em eventuais disputas.",
        "Áudio, quadros e textos enviados aos fornecedores de IA: não guardamos cópia do áudio nem dos quadros; cada fornecedor tem o seu próprio prazo de retenção, descrito na política dele.",
      ],
    ],
  },
  {
    title: "Os seus direitos",
    body: [`Você pode pedir confirmação do tratamento, acesso, correção, portabilidade, anonimização, eliminação dos dados e informações sobre o compartilhamento, além de revogar consentimentos e se opor a tratamentos, nos termos do art. 18 da LGPD. Escreva para ${LEGAL.email}. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).`],
  },
  {
    title: "Pessoas que aparecem nos vídeos",
    body: ["Você é responsável por ter autorização das pessoas que aparecem ou falam nos vídeos que edita, inclusive para o envio do áudio à transcrição e à IA."],
  },
  {
    title: "Menores de idade",
    body: ["O serviço é destinado a maiores de 18 anos. Não coletamos intencionalmente dados de crianças e adolescentes."],
  },
  {
    title: "Mudanças nesta política",
    body: ["Se esta política mudar de forma relevante, avisaremos por e-mail ou dentro do produto antes de a mudança valer."],
  },
];

export default function PrivacyPage() {
  return <LegalPage title="Política de Privacidade" intro={`Esta política explica quais dados o ${LEGAL.product} trata, por quê, com quem compartilha e como você exerce os seus direitos.`} sections={SECTIONS} />;
}
