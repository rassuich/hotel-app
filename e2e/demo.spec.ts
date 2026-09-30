import { expect, test, type Browser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * End-to-end demonstration on the built app: several guest devices on one stay,
 * two Room Service tablets and a Reception tablet, all live.
 */
function activationLinks(): string[] {
  const seed = readFileSync('.e2e/seed.txt', 'utf8');
  return [...seed.matchAll(/(http:\/\/\S+\/activate\?p=\S+)/g)].map((m) => m[1]);
}
function validationCodes(): string[] {
  const seed = readFileSync('.e2e/seed.txt', 'utf8');
  return [...seed.matchAll(/Code:\s+(\S+)/g)].map((m) => m[1]);
}

/** A guest phone opening the private QR link: language first, then the room number. */
async function guestDevice(browser: Browser, link: string, room: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(link);
  // The private token is removed from the address bar before anything else.
  expect(page.url()).not.toContain('#t=');
  await page.getByRole('button', { name: /Français/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirmez votre chambre' })).toBeVisible();
  await page.getByLabel('Numéro de chambre').fill(room);
  await page.getByRole('button', { name: 'Valider' }).click();
  await page.waitForURL('**/h');
  return page;
}

async function staffTablet(browser: Browser, username: string, password: string, device: string, path = '/staff'): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(path);
  await page.getByLabel('Compte').fill(username);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('button', { name: device }).click();
  await expect(page.getByText('En direct')).toBeVisible();
  return page;
}

async function addTeaAndSend(page: Page) {
  await page.goto('/h/food');
  await page.getByRole('button', { name: 'Boissons' }).click();
  await page.getByRole('button', { name: /Thé à la menthe/ }).click();
  await page.getByRole('button', { name: /Ajouter à la commande/ }).click();
  await page.getByRole('link', { name: /Voir la commande/ }).click();
  await expect(page.getByText('Le Room Service appellera votre chambre')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test('only validated guests get in: every entry point lands on the language and validation gate', async ({ page }) => {
  for (const path of ['/h', '/h/food', '/h/services', '/p/palace-anfa']) {
    await page.goto(path);
    await expect(page.getByText('Choisissez votre langue · Choose your language · Elija su idioma')).toBeVisible();
  }
  for (const api of ['/api/guest/catalog/menu', '/api/guest/catalog/content', '/api/guest/catalog/services']) {
    expect((await page.request.get(api)).status()).toBe(401);
  }
  await page.getByRole('button', { name: /Français/ }).click();
  await expect(page.getByRole('heading', { name: 'Validez votre séjour' })).toBeVisible();
  // The in-app scanner really opens the camera (the server's Permissions-Policy allows it for our origin).
  await page.context().grantPermissions(['camera']);
  await page.getByRole('button', { name: "Ouvrir l'appareil photo" }).click();
  await expect(page.locator('.scanner video')).toBeVisible();
  await expect.poll(() => page.locator('.scanner video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  await expect(page.getByText("L'accès à l'appareil photo n'a pas été autorisé")).toHaveCount(0);
  await page.getByRole('button', { name: "Fermer l'appareil photo" }).click();
  // A wrong code never reveals anything.
  await page.getByLabel('Code de validation', { exact: true }).fill('ZZZZ-ZZZZ-ZZZZ');
  await page.getByLabel('Numéro de chambre').fill('DEMO-101');
  await page.getByRole('button', { name: 'Valider' }).click();
  await expect(page.getByText('Nous n\'avons pas pu vérifier ce code', { exact: false })).toBeVisible();
});

test('full food workflow: two tablets, failed confirmation, same-ticket callback, POS entry', async ({ browser }) => {
  const [link] = activationLinks();
  const phone = await guestDevice(browser, link, 'DEMO-101');
  const tablet = await guestDevice(browser, link, 'demo101'); // a second occupant's device
  const rs1 = await staffTablet(browser, 'palace.roomservice', 'demo-roomservice', 'Room Service Tablet 1');
  const rs2 = await staffTablet(browser, 'palace.roomservice', 'demo-roomservice', 'Room Service Tablet 2');

  await addTeaAndSend(phone);
  await phone.getByRole('button', { name: /Envoyer pour confirmation/ }).click();
  await phone.waitForURL('**/h/requests/PA-*');
  const ref = phone.url().split('/').pop()!;
  await expect(phone.getByText('Envoyée — en attente de l\'appel de confirmation').first()).toBeVisible();

  // Both tablets are alerted live, without reloading.
  const card1 = rs1.locator('article', { hasText: ref });
  const card2 = rs2.locator('article', { hasText: ref });
  await expect(card1).toBeVisible();
  await expect(card2).toBeVisible();

  // Tablet 1 takes it; tablet 2 sees who is handling it.
  await card1.getByRole('button', { name: 'Prendre cette demande' }).click();
  await expect(card2.getByText('Prise par Room Service Tablet 1')).toBeVisible();
  await expect(card2.getByRole('button', { name: 'Prendre cette demande' })).toHaveCount(0);

  // Nobody answers the room call.
  await card1.getByRole('button', { name: 'Confirmation non reçue' }).click();
  await expect(card1.getByText('En attente — le client peut demander un nouvel appel.')).toBeVisible();

  // The device showing the request updates live and explains what happened (reading the notice).
  await expect(phone.getByText("Nous n'avons pas pu confirmer votre commande")).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Demander un nouvel appel de confirmation' })).toBeVisible();

  // The other guest device sees the same shared history and asks for another call on the SAME ticket.
  await tablet.goto('/h/requests');
  await tablet.getByRole('link', { name: new RegExp(`Nous n'avons pas pu vous joindre.*${ref}`) }).click();
  await expect(tablet.getByText("Nous n'avons pas pu confirmer votre commande")).toBeVisible();
  await tablet.getByRole('button', { name: 'Demander un nouvel appel de confirmation' }).click();
  await expect(tablet.getByText('Nous vous rappellerons sous peu pour la même commande.')).toBeVisible();

  // Re-alerted as a new attempt of the same ticket; tablet 2 takes it this time.
  await expect(card2.getByRole('button', { name: 'Prendre cette demande' })).toBeVisible();
  await card2.getByRole('button', { name: 'Prendre cette demande' }).click();
  await expect(card1.getByText('Prise par Room Service Tablet 2')).toBeVisible();
  await card2.getByRole('button', { name: 'Confirmée par téléphone' }).click();
  await card2.getByLabel('Référence caisse (facultatif)').fill('POS-4411');
  await card2.getByRole('button', { name: 'Saisie en caisse' }).click();
  await expect(card2.getByText('Saisie en caisse · POS-4411')).toBeVisible();
  await card2.getByRole('button', { name: 'Lancer la préparation' }).click();
  await card2.getByRole('button', { name: 'Marquer livrée / terminée' }).click();

  // Guest devices see the delivered state; one ticket, two call attempts.
  await phone.goto(`/h/requests/${ref}`);
  await expect(phone.getByText('Livrée').first()).toBeVisible();
  await expect(phone.getByText('Tentative 1 : sans réponse')).toBeVisible();
  await expect(phone.getByText('Tentative 2 : confirmée')).toBeVisible();
  const list = await phone.request.get('/api/guest/requests');
  expect((await list.json()).requests.filter((r: { type: string }) => r.type === 'food')).toHaveLength(1);
});

test('services: several ticked items become ONE request; no call; housekeeping and completion', async ({ browser }) => {
  const [link] = activationLinks();
  const guest = await guestDevice(browser, link, 'DEMO-101');
  const rc = await staffTablet(browser, 'palace.reception', 'demo-reception', 'Reception Tablet 1');
  await guest.goto('/h/services');
  await guest.getByLabel('Serviettes').check();
  await guest.getByLabel('Précisions (facultatif)').fill('Deux grandes');
  await guest.getByLabel('Brosse à dents').check();
  await guest.getByLabel('Oreiller supplémentaire').check();
  await guest.getByRole('button', { name: /Vérifier la demande/ }).click();
  const sheet = guest.getByRole('dialog');
  await expect(sheet.getByText('1 × Serviettes')).toBeVisible();
  await expect(sheet.getByText('1 × Brosse à dents')).toBeVisible();
  await sheet.getByRole('button', { name: 'Envoyer la demande' }).click();
  await guest.waitForURL('**/h/requests/PA-*');
  await expect(guest.getByText('Demande envoyée à la réception.')).toBeVisible();
  const ref = guest.url().split('/').pop()!;

  const card = rc.locator('article', { hasText: ref });
  await expect(card.getByText('Serviettes')).toBeVisible();
  await expect(card.getByText('Brosse à dents')).toBeVisible();
  await expect(card.getByText('Oreiller supplémentaire')).toBeVisible();
  await card.getByRole('button', { name: 'Prendre cette demande' }).click();
  await expect(card.getByRole('button', { name: 'Confirmée par téléphone' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Gouvernante contactée' }).click();
  await expect(card.getByText(/Gouvernante contactée à/)).toBeVisible();
  await card.getByRole('button', { name: 'Terminée' }).click();
  await guest.goto('/h/requests');
  await expect(guest.getByText('Terminée').first()).toBeVisible();
  const list = await guest.request.get('/api/guest/requests');
  expect((await list.json()).requests.filter((r: { type: string }) => r.type === 'service')).toHaveLength(1);
});

test('services: an item that becomes unavailable during review must be acknowledged before sending', async ({ browser }) => {
  const [link] = activationLinks();
  const guest = await guestDevice(browser, link, 'DEMO-101');
  const adm = await (await browser.newContext()).newPage();
  await adm.goto('/admin');
  await adm.getByLabel('Compte').fill('palace.admin');
  await adm.getByLabel('Mot de passe').fill('demo-admin-pass');
  await adm.getByRole('button', { name: 'Se connecter' }).click();
  await expect(adm.getByRole('link', { name: 'Séjours et QR' }).first()).toBeVisible();

  await guest.goto('/h/services');
  await guest.getByLabel('Kit de rasage').check();
  await guest.getByLabel('Brosse à dents').check();
  await guest.getByRole('button', { name: /Vérifier la demande/ }).click();
  // Meanwhile the hotel marks the shaving kit unavailable.
  const services = (await (await adm.request.get('/api/admin/services')).json()).services as { id: number; nameEn: string }[];
  const kit = services.find((x) => x.nameEn === 'Shaving kit')!;
  const csrf = (await adm.context().cookies()).find((c) => c.name === 'pa_csrf')!.value;
  expect((await adm.request.patch(`/api/admin/services/${kit.id}`, { data: { available: false }, headers: { 'x-csrf-token': csrf } })).status()).toBe(200);

  const sheet = guest.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(sheet.getByText("Kit de rasage n'est plus disponible")).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Envoyer la demande' })).toBeDisabled();
  await sheet.getByRole('button', { name: 'Accepter la demande mise à jour' }).click();
  await expect(sheet.getByText(/retiré\(s\) de votre demande : Kit de rasage/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Envoyer la demande' }).click();
  await guest.waitForURL('**/h/requests/PA-*');
  await expect(guest.getByText('1 × Brosse à dents')).toBeVisible();
  await expect(guest.getByText('Kit de rasage')).toHaveCount(0);
  await adm.request.patch(`/api/admin/services/${kit.id}`, { data: { available: true }, headers: { 'x-csrf-token': csrf } });
});

test('pool orders use configured labels and in-person confirmation', async ({ browser }) => {
  const [link] = activationLinks();
  const guest = await guestDevice(browser, link, 'DEMO-101');
  const rs = await staffTablet(browser, 'palace.roomservice', 'demo-roomservice', 'Room Service Tablet 1');
  await addTeaAndSend(guest);
  await guest.getByLabel('Piscine').check();
  await guest.getByLabel('Choisissez votre table ou transat').selectOption({ label: 'Piscine – Transat L3 (démo)' });
  await expect(guest.getByText('Un membre du personnel viendra à votre emplacement')).toBeVisible();
  await guest.getByRole('button', { name: /Envoyer pour confirmation/ }).click();
  await guest.waitForURL('**/h/requests/PA-*');
  const card = rs.locator('article', { hasText: 'Pool – Lounger L3 (demo)' }).or(rs.locator('article', { hasText: 'Piscine – Transat L3 (démo)' }));
  await card.getByRole('button', { name: 'Prendre cette demande' }).click();
  await expect(card.getByText(/Aller à .* pour confirmer en personne/)).toBeVisible();
  await card.getByRole('button', { name: 'Confirmée en personne' }).click();
  await expect(card.getByText('Non saisie en caisse')).toBeVisible();
});

test('offline: the cart is kept and never sent automatically on reconnect', async ({ browser }) => {
  const [, link] = activationLinks();
  const guest = await guestDevice(browser, link, 'DEMO-102');
  await addTeaAndSend(guest);
  const before = (await (await guest.request.get('/api/guest/requests')).json()).requests.length;
  await guest.context().setOffline(true);
  await expect(guest.getByText(/Vous êtes hors ligne\. Votre commande est conservée/)).toBeVisible();
  await expect(guest.getByRole('button', { name: /Envoyer pour confirmation/ })).toBeDisabled();
  await guest.context().setOffline(false);
  await guest.waitForTimeout(1500);
  const after = (await (await guest.request.get('/api/guest/requests')).json()).requests.length;
  expect(after).toBe(before);
  await guest.reload();
  await expect(guest.getByText('Thé à la menthe')).toBeVisible(); // still in the cart
});

test('reception room move signs the old device out; checkout blocks ordering', async ({ browser }) => {
  const [, link] = activationLinks();
  const guest = await guestDevice(browser, link, 'DEMO-102');
  const desk = await staffTablet(browser, 'palace.reception', 'demo-reception', 'Reception Tablet 2', '/admin/stays');
  await desk.goto('/admin/stays');
  const stay = desk.locator('.stay', { hasText: 'DEMO-102 · Demo Guest B' });
  await stay.getByRole('button', { name: 'Changer de chambre' }).click();
  const dialog = desk.getByRole('dialog');
  await dialog.getByLabel('Chambre').selectOption({ label: 'DEMO-205' });
  await dialog.getByRole('button', { name: 'Confirmer' }).click();
  await expect(desk.getByRole('heading', { name: /QR d'activation privé — DEMO-205/ })).toBeVisible();
  const newLink = await desk.locator('.url').innerText();
  // Printing outputs only the guest card: QR, code and FR/EN/ES instructions — no room, no other guests.
  await desk.emulateMedia({ media: 'print' });
  await expect(desk.locator('.print-card')).toBeVisible();
  await expect(desk.locator('.print-card')).not.toContainText('DEMO-');
  await expect(desk.locator('.print-card')).toContainText('Su aplicación de huésped');
  await expect(desk.locator('.stay').first()).toBeHidden();
  await desk.emulateMedia({ media: 'screen' });
  await expect(desk.getByTestId('validation-code')).toHaveText(/^\w{4}-\w{4}-\w{4}$/);
  await desk.getByRole('button', { name: 'Fermer' }).click();

  await guest.goto('/h/requests');
  await expect(guest.getByText(/Cet appareil a été déconnecté/)).toBeVisible();
  await expect(guest.getByRole('heading', { name: 'Validez votre séjour' })).toBeVisible();

  // New QR for the new room works; then checkout stops ordering on that device.
  const moved = await guestDevice(browser, newLink, 'DEMO-205');
  desk.once('dialog', (d) => d.accept());
  await desk.locator('.stay', { hasText: 'DEMO-205 · Demo Guest B' }).getByRole('button', { name: 'Départ', exact: true }).click();
  await expect(desk.locator('.stay', { hasText: 'DEMO-205 · Demo Guest B' })).toHaveCount(0);
  await moved.goto('/h/stay');
  await expect(moved.getByText('Votre séjour est terminé. Les commandes sont fermées.')).toBeVisible();
  await expect(moved.getByText('Pour votre facture, veuillez contacter la réception.')).toBeVisible();
  const r = await moved.request.post('/api/guest/requests/service', { data: {} });
  expect(r.status()).toBe(403);
});

test('Spanish and English: typed validation code, then the whole app in the chosen language', async ({ browser }) => {
  const [code] = validationCodes();
  const ctx = await browser.newContext({ locale: 'de-DE', viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /Español/ }).click();
  await expect(page.getByRole('heading', { name: 'Valide su estancia' })).toBeVisible();
  await page.getByLabel('Código de validación', { exact: true }).fill(code.toLowerCase());
  await page.getByLabel('Número de habitación').fill('demo-101');
  await page.getByRole('button', { name: 'Validar' }).click();
  await page.waitForURL('**/h');
  await expect(page.getByRole('heading', { name: /Le Palace d'Anfa/ })).toBeVisible();
  await page.goto('/h/food');
  await expect(page.getByRole('button', { name: 'Desayuno' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Tortilla francesa/ })).toBeVisible();
  await page.goto('/h/services');
  await expect(page.getByLabel('Toallas')).toBeVisible();
  // Switch to English from the masthead.
  await page.locator('select.lang-select').selectOption('en');
  await expect(page.getByLabel('Towels')).toBeVisible();
  await page.goto('/h/food');
  await expect(page.getByRole('button', { name: 'Breakfast' })).toBeVisible();
});
