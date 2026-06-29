/**
 * SPIKE — test local du flux d'auth Garmin en TypeScript/Node.
 *
 * Objectif : prouver qu'un client Node (fetch) peut s'authentifier auprès de
 * Garmin (login + MFA + échange de ticket) et appeler l'API — AVANT de câbler
 * quoi que ce soit dans des Functions serverless.
 *
 * Tes identifiants ne transitent QUE par ta machine (variables d'env / saisie).
 *
 * Lancement (PowerShell, depuis my-ai-coach/) :
 *   $env:GARMIN_EMAIL    = "ton_email"
 *   $env:GARMIN_PASSWORD = "ton_mot_de_passe"
 *   npm run spike:garmin
 *
 * (ou sans variables d'env : le script les demandera ; le mot de passe est masqué)
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { Buffer } from "node:buffer";

import {
  login,
  completeMfa,
  exchangeServiceTicket,
  connectApi,
  refreshTokens,
  tokenExpiresSoon,
  type GarminTokens,
} from "../netlify/functions/_shared/garmin/auth.ts";

const rl = createInterface({ input: stdin, output: stdout });

async function ask(question: string): Promise<string> {
  return (await rl.question(question)).trim();
}

/**
 * Saisie masquée (best-effort) pour le mot de passe.
 * Comparaison par code d'octet pour éviter tout littéral de caractère de contrôle.
 *   13=CR  10=LF  4=EOT(valider) · 3=ETX(Ctrl+C) · 8=BS  127=DEL(effacer)
 */
async function askSecret(question: string): Promise<string> {
  stdout.write(question);
  const isTTY = Boolean(stdin.isTTY);
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: Buffer) => {
      const byte = chunk[0];
      if (byte === 13 || byte === 10 || byte === 4) {
        stdin.removeListener("data", onData);
        if (isTTY) stdin.setRawMode(false);
        stdin.pause();
        stdout.write("\n");
        resolve(value);
      } else if (byte === 3) {
        process.exit(1);
      } else if (byte === 8 || byte === 127) {
        value = value.slice(0, -1);
      } else {
        value += chunk.toString("utf-8");
      }
    };
    if (isTTY) stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

async function main() {
  console.log("\n=== SPIKE auth Garmin (TypeScript) ===\n");

  const email = process.env.GARMIN_EMAIL || (await ask("Email Garmin : "));
  const password =
    process.env.GARMIN_PASSWORD || (await askSecret("Mot de passe : "));

  console.log("\n[1/4] Login identifiants (mobile, repli widget si 429)...");
  const result = await login(email, password);

  let ticket: string;
  let serviceUrl: string;
  if (result.type === "success") {
    console.log("      -> SUCCESSFUL (pas de MFA)");
    ticket = result.ticket;
    serviceUrl = result.serviceUrl;
  } else {
    console.log(`      -> MFA_REQUIRED (flux: ${result.flow}, méthode: ${result.mfaMethod})`);
    const code = await ask("      Code MFA reçu : ");
    console.log("[2/4] Vérification du code MFA...");
    const done = await completeMfa(result.session, code);
    ticket = done.ticket;
    serviceUrl = done.serviceUrl;
  }
  console.log(`      Ticket obtenu : ${ticket.slice(0, 16)}...`);

  console.log("[3/4] Échange du ticket contre des tokens DI...");
  let tokens: GarminTokens = await exchangeServiceTicket(ticket, serviceUrl);
  console.log(
    `      access_token OK (client_id=${tokens.clientId}), ` +
      `refresh_token=${tokens.refreshToken ? "présent" : "absent"}`,
  );
  console.log(
    `      Token expire bientôt ? ${tokenExpiresSoon(tokens.accessToken)}`,
  );

  console.log("[4/4] Appel API authentifié (profil)...");
  const profile = await connectApi<any>(
    tokens.accessToken,
    "/userprofile-service/socialProfile",
  );
  console.log(
    `      ✅ Profil récupéré : ${profile?.displayName ?? profile?.userName ?? "(nom indisponible)"}`,
  );

  // Bonus : valider le refresh token
  if (tokens.refreshToken) {
    console.log("\n[bonus] Test du rafraîchissement du token...");
    try {
      tokens = await refreshTokens(tokens);
      console.log("      ✅ Refresh OK — nouveau access_token obtenu");
    } catch (e) {
      console.log(`      ⚠️ Refresh échoué : ${(e as Error).message}`);
    }
  }

  console.log("\n🎉 SPIKE RÉUSSI — le flux Garmin fonctionne en Node.\n");
  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(
    `\n❌ SPIKE ÉCHOUÉ : ${err?.name ?? "Error"} — ${err?.message ?? err}\n`,
  );
  console.error(
    "Si c'est un 403 / non-JSON / Cloudflare : le fetch Node est filtré.\n" +
      "On testera alors un contournement (en-têtes, undici, ou lib alternative).\n",
  );
  rl.close();
  process.exit(1);
});
