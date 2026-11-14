import { PLANS, SIGNUP_CREDITS } from "@videoeditor/core";
import { LegalPage, type LegalSection } from "@/components/LegalPage";
import { LEGAL } from "@/lib/legal";

export const metadata = { title: `Termos de Uso — ${LEGAL.product}` };

const SECTIONS: LegalSection[] = [
  {
    title: "Quem somos e o que é o serviço",
    body: [
      `O ${LEGAL.product} é um editor de vídeo que roda no navegador, operado por ${LEGAL.company}, CNPJ ${LEGAL.cnpj}, com sede em ${LEGAL.address}. Ao criar uma conta você concorda com estes Termos e com a Política de Privacidade.`,
      "O serviço edita vídeos a partir da fala: transcreve, corta erros e pausas, legenda, enquadra e anima, com inteligência artificial. A edição manual e a exportação acontecem no seu próprio aparelho.",
    ],
  },
  {
    title: "Conta",
    body: ["Você precisa ter 18 anos ou mais, informar dados verdadeiros e manter a senha em sigilo. O que for feito com a sua conta é responsabilidade sua. Podemos suspender contas usadas para fraude, abuso do serviço ou violação destes Termos."],
  },
  {
    title: "Créditos, planos e pagamento",
    body: [
      [
        "Créditos pagam o que usa inteligência artificial: transcrição, edição pela IA, ajustes por texto e geração de imagens e vídeos. Edição manual e exportação no navegador não consomem créditos.",
        `A conta gratuita recebe ${SIGNUP_CREDITS} créditos uma única vez, exporta em até ${PLANS.free.maxExportHeight}p com marca d'água e aceita vídeos de até ${PLANS.free.maxUploadMinutes} minutos.`,
        "Planos pagos são assinaturas mensais com renovação automática, cobradas pelo Stripe. Os créditos do plano valem para o ciclo em que foram concedidos e não acumulam para o seguinte.",
        "Créditos de pacotes avulsos somam ao saldo e não expiram enquanto a conta existir.",
        "O preço de cada ação aparece antes de você confirmar. Se uma edição pela IA for interrompida antes de terminar, cobramos metade do preço dela.",
        "Você pode cancelar a assinatura quando quiser, pelo portal de pagamentos; o plano continua até o fim do período já pago.",
      ],
    ],
  },
  {
    title: "Arrependimento, estorno e contestação",
    body: [
      "Você pode desistir de uma compra feita pela internet em até 7 dias, nos termos do art. 49 do Código de Defesa do Consumidor, escrevendo para o contato abaixo.",
      "Em caso de estorno ou de contestação da cobrança no cartão, os créditos daquela compra que ainda estiverem no saldo são removidos.",
    ],
  },
  {
    title: "O seu conteúdo",
    body: [
      "Os vídeos, as transcrições e as edições são seus. Você nos dá apenas a licença necessária para prestar o serviço: processar o áudio, o texto e os quadros descritos na Política de Privacidade e guardar a edição na sua conta.",
      "Você declara ter os direitos sobre o que envia (imagem, voz, música, marcas) e autorização das pessoas que aparecem nos vídeos.",
    ],
  },
  {
    title: "Uso aceitável",
    body: [
      "Não é permitido usar o serviço para:",
      [
        "conteúdo ilegal, que viole direitos de terceiros ou que explore crianças e adolescentes;",
        "enganar pessoas com conteúdo que se passe por alguém real sem autorização;",
        "burlar limites, revender o acesso ou automatizar o uso de forma a sobrecarregar a plataforma;",
        "tentar acessar dados de outras contas ou a infraestrutura do serviço.",
      ],
    ],
  },
  {
    title: "Resultados da inteligência artificial",
    body: [
      "A edição automática é uma proposta: a IA pode cortar um trecho que você queria manter, errar uma palavra na legenda ou escolher um destaque inadequado. Revise o vídeo antes de publicar. Você é responsável pelo que publica.",
      "Imagens e vídeos gerados por IA a seu pedido podem se parecer com obras existentes; confira antes de usar comercialmente.",
    ],
  },
  {
    title: "Mídias e sons de terceiros",
    body: ["Imagens e vídeos de bancos gratuitos (Pexels, Pixabay) seguem a licença de cada banco: confira as condições de uso antes de publicar."],
  },
  {
    title: "Disponibilidade e limites técnicos",
    body: [
      "O vídeo fica no seu navegador: se você limpar os dados do navegador ou trocar de aparelho, a edição continua salva na conta, mas será preciso escolher de novo o arquivo de vídeo original. Guarde os seus arquivos brutos.",
      "A exportação depende do navegador e do aparelho; recomendamos uma versão recente do Chrome ou do Edge. O serviço pode ficar indisponível para manutenção ou por falha de fornecedores.",
    ],
  },
  {
    title: "Responsabilidade",
    body: ["Respondemos pelos danos que causarmos por falha na prestação do serviço, nos limites da lei. Não respondemos por perda de arquivos guardados apenas no seu aparelho, por decisões tomadas com base no conteúdo editado nem por indisponibilidade de serviços de terceiros."],
  },
  {
    title: "Encerramento",
    body: [`Você pode pedir o encerramento da conta e a exclusão dos seus dados escrevendo para ${LEGAL.email}. Créditos não usados não são convertidos em dinheiro, salvo nos casos previstos em lei.`],
  },
  {
    title: "Mudanças, lei aplicável e contato",
    body: [`Mudanças relevantes nestes Termos serão avisadas com antecedência por e-mail ou dentro do produto. Estes Termos seguem a lei brasileira; fica eleito o foro de ${LEGAL.forum}, sem prejuízo do direito do consumidor de escolher o foro do seu domicílio. Contato: ${LEGAL.email}.`],
  },
];

export default function TermsPage() {
  return <LegalPage title="Termos de Uso" intro={`Estes Termos regulam o uso do ${LEGAL.product}. Leia com atenção: eles valem como contrato entre você e a empresa.`} sections={SECTIONS} />;
}
