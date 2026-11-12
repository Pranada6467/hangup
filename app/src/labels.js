'use strict';
// Plain-language labels for reason codes, for the web UI and the extension.
const REASON_LABELS = {
  en: {
    PHONE_IN_TEXT: 'It contains a phone number',
    CALLBACK_DEMANDED: 'It tells you to phone them',
    UNRECOGNISED_CHARGE: 'It talks about a charge you may not have made',
    BRAND_MISMATCH: "It names a company that isn't the sender",
    REMOTE_ACCESS_OR_REFUND: 'It mentions remote access or a refund',
    URGENCY: 'It pushes you to act fast',
    PAYMENT_OUTSIDE_PAYPAL: 'It asks for payment outside PayPal',
    INJECTION_ATTEMPT: 'It contains hidden instructions aimed at checkers',
    UNFAMILIAR_SELLER: 'You have not paid this seller before, and the invoice says almost nothing except a number',
  },
  es: {
    PHONE_IN_TEXT: 'Contiene un número de teléfono',
    CALLBACK_DEMANDED: 'Le dice que los llame por teléfono',
    UNRECOGNISED_CHARGE: 'Habla de un cargo que quizá usted no hizo',
    BRAND_MISMATCH: 'Nombra a una empresa que no es quien lo envía',
    REMOTE_ACCESS_OR_REFUND: 'Menciona acceso remoto o un reembolso',
    URGENCY: 'Le presiona para que actúe rápido',
    PAYMENT_OUTSIDE_PAYPAL: 'Le pide pagar fuera de PayPal',
    INJECTION_ATTEMPT: 'Contiene instrucciones ocultas dirigidas a los verificadores',
    UNFAMILIAR_SELLER: 'Usted no le ha pagado antes a este vendedor, y la factura casi no dice nada salvo un número',
  },
  fr: {
    PHONE_IN_TEXT: 'Il contient un numéro de téléphone',
    CALLBACK_DEMANDED: 'Il vous demande de les appeler',
    UNRECOGNISED_CHARGE: 'Il parle d\'un débit que vous n\'avez peut-être pas fait',
    BRAND_MISMATCH: 'Il cite une entreprise qui n\'est pas l\'expéditeur',
    REMOTE_ACCESS_OR_REFUND: 'Il mentionne un accès à distance ou un remboursement',
    URGENCY: 'Il vous pousse à agir vite',
    PAYMENT_OUTSIDE_PAYPAL: 'Il demande un paiement en dehors de PayPal',
    INJECTION_ATTEMPT: 'Il contient des instructions cachées visant les outils de vérification',
    UNFAMILIAR_SELLER: 'Vous n\'avez jamais payé ce vendeur, et la facture ne dit presque rien à part un numéro',
  },
};
function reasonLabel(code, lang = 'en') { return (REASON_LABELS[lang] || REASON_LABELS.en)[code] || REASON_LABELS.en[code] || code; }
module.exports = { REASON_LABELS, reasonLabel };
