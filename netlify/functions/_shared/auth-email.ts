/**
 * Gabarits d'e-mails d'authentification (thème du site) envoyés via Resend,
 * pilotés par le "Send Email Hook" de Supabase Auth. Un template unique adapté au
 * type d'action (inscription, réinit. mot de passe, magic link, changement d'e-mail…).
 */

const GREEN = "#16a34a";
const INK = "#171717";
const MUTED = "#525252";
const FAINT = "#a3a3a3";
const BORDER = "#e5e5e5";
const BG = "#f5f5f5";

interface Copy {
  subject: string;
  heading: string;
  body: string;
  button: string;
}

function copyFor(action: string): Copy {
  switch (action) {
    case "signup":
      return {
        subject: "Confirme ton inscription à my-ai-coach",
        heading: "Bienvenue 👋",
        body: "Merci de rejoindre my-ai-coach, ton coach sportif IA. Confirme ton adresse e-mail pour activer ton compte et commencer à t'entraîner.",
        button: "Confirmer mon adresse",
      };
    case "recovery":
      return {
        subject: "Réinitialise ton mot de passe",
        heading: "Mot de passe oublié ?",
        body: "Clique ci-dessous pour choisir un nouveau mot de passe. Si tu n'es pas à l'origine de cette demande, ignore cet e-mail : rien ne change.",
        button: "Réinitialiser mon mot de passe",
      };
    case "magiclink":
      return {
        subject: "Ta connexion à my-ai-coach",
        heading: "Connexion",
        body: "Clique sur le bouton ci-dessous pour te connecter à ton compte my-ai-coach.",
        button: "Se connecter",
      };
    case "invite":
      return {
        subject: "Tu es invité(e) sur my-ai-coach",
        heading: "Une invitation t'attend",
        body: "Tu as été invité(e) à rejoindre my-ai-coach. Clique ci-dessous pour créer ton accès.",
        button: "Rejoindre",
      };
    default:
      // email_change, email_change_new, email_change_current, reauthentication…
      if (action.startsWith("email_change"))
        return {
          subject: "Confirme ta nouvelle adresse e-mail",
          heading: "Changement d'adresse",
          body: "Confirme ta nouvelle adresse e-mail pour la lier à ton compte my-ai-coach.",
          button: "Confirmer l'adresse",
        };
      return {
        subject: "Vérification my-ai-coach",
        heading: "Vérification",
        body: "Confirme cette action sur ton compte my-ai-coach.",
        button: "Confirmer",
      };
  }
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * @param action   email_action_type du hook Supabase
 * @param url      lien de vérification (null pour la reauthentication par code)
 * @param token    code OTP (reauthentication)
 */
export function renderAuthEmail(action: string, url: string | null, token?: string | null): RenderedEmail {
  const c = copyFor(action);
  const isCode = !url && !!token;

  const cta = isCode
    ? `<div style="margin:8px 0 4px;font-size:13px;color:${MUTED};">Ton code de vérification :</div>
       <div style="display:inline-block;font-family:'SFMono-Regular',Consolas,monospace;font-size:26px;letter-spacing:6px;font-weight:700;color:${INK};background:${BG};border:1px solid ${BORDER};border-radius:10px;padding:12px 20px;">${token}</div>`
    : `<a href="${url}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:13px 22px;border-radius:10px;">${c.button}</a>`;

  const linkFallback =
    !isCode && url
      ? `<p style="font-size:12px;color:${FAINT};line-height:1.6;margin:24px 0 0;">Le bouton ne fonctionne pas ? Copie ce lien dans ton navigateur :<br />
         <span style="word-break:break-all;color:${MUTED};">${url}</span></p>`
      : "";

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid ${BORDER};border-radius:16px;">
            <tr>
              <td style="padding:32px;">
                <div style="font-size:18px;font-weight:700;color:${INK};">
                  <span style="color:${GREEN};">●</span> my-ai-coach
                </div>
                <h1 style="font-size:20px;font-weight:600;color:${INK};margin:26px 0 10px;">${c.heading}</h1>
                <p style="font-size:14px;line-height:1.65;color:${MUTED};margin:0 0 26px;">${c.body}</p>
                ${cta}
                ${linkFallback}
              </td>
            </tr>
          </table>
          <p style="max-width:480px;font-size:12px;color:${FAINT};line-height:1.6;margin:16px auto 0;text-align:center;">
            my-ai-coach — ton coach sportif IA.<br />
            Si tu n'es pas à l'origine de cet e-mail, tu peux l'ignorer en toute sécurité.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = isCode
    ? `${c.heading}\n\n${c.body}\n\nCode : ${token}\n\nmy-ai-coach`
    : `${c.heading}\n\n${c.body}\n\n${c.button} : ${url}\n\nmy-ai-coach`;

  return { subject: c.subject, html, text };
}
