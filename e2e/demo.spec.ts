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

async function guestDevice(browser: Browser, link: string, room: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(link);
  // The private token is removed from the address bar before anything else.
  expect(page.url()).not.toContain('#t=');
  await page.getByLabel('Numéro de chambre').fill(room);
  await page.getByRole('button', { name: 'Activer' }).click();
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

test('public menus work without login and a public hotel link cannot authenticate', async ({ page }) => {
  await page.goto('/p/palace-anfa');
  await expect(page.getByRole('heading', { name: /Bienvenue au Le Palace d'Anfa/ })).toBeVisible();
  await page.goto('/h/food');
  await expect(page.getByRole('button', { name: /Omelette/ })).toBeVisible();
  await page.goto('/h/requests');
  await expect(page.getByText('Activez votre séjour pour voir vos demandes.')).toBeVisible();
  const me = await page.request.get('/api/guest/me');
  expect(me.status()).toBe(401);
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

test('services: no call, reception records housekeeping hand-off and completion', async ({ browser }) => {
  const [link] = activationLinks();
  const guest = await guestDevice(browser, link, 'DEMO-101');
  const rc = await staffTablet(browser, 'palace.reception', 'demo-reception', 'Reception Tablet 1');
  await guest.goto('/h/services');
  await guest.getByRole('button', { name: /Serviettes/ }).click();
  await guest.getByLabel('Précisions (facultatif)').fill('Deux grandes');
  await guest.getByRole('button', { name: 'Envoyer la demande' }).click();
  await expect(guest.getByText('Demande envoyée à la réception.')).toBeVisible();

  const card = rc.locator('article', { hasText: 'Serviettes' });
  await card.getByRole('button', { name: 'Prendre cette demande' }).click();
  await expect(card.getByRole('button', { name: 'Confirmée par téléphone' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Gouvernante contactée' }).click();
  await expect(card.getByText(/Gouvernante contactée à/)).toBeVisible();
  await card.getByRole('button', { name: 'Terminée' }).click();
  await guest.goto('/h/requests');
  await expect(guest.getByText('Terminée').first()).toBeVisible();
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
  const stay = desk.locator('.card', { hasText: 'DEMO-102 · Demo Guest B' });
  await stay.getByRole('button', { name: 'Changer de chambre' }).click();
  const dialog = desk.getByRole('dialog');
  await dialog.getByLabel('Chambre').selectOption({ label: 'DEMO-205' });
  await dialog.getByRole('button', { name: 'Confirmer' }).click();
  await expect(desk.getByRole('heading', { name: /QR d'activation privé — DEMO-205/ })).toBeVisible();
  const newLink = await desk.locator('.qr-url').innerText();
  await desk.getByRole('button', { name: 'Fermer' }).click();

  await guest.goto('/h/requests');
  await expect(guest.getByText(/Cet appareil a été déconnecté/)).toBeVisible();

  // New QR for the new room works; then checkout stops ordering on that device.
  const moved = await guestDevice(browser, newLink, 'DEMO-205');
  desk.once('dialog', (d) => d.accept());
  await desk.locator('.card', { hasText: 'DEMO-205 · Demo Guest B' }).getByRole('button', { name: 'Départ', exact: true }).click();
  await expect(desk.locator('.card', { hasText: 'DEMO-205 · Demo Guest B' })).toHaveCount(0);
  await moved.goto('/h/stay');
  await expect(moved.getByText('Votre séjour est terminé. Les commandes sont fermées.')).toBeVisible();
  await expect(moved.getByText('Pour votre facture, veuillez contacter la réception.')).toBeVisible();
  const r = await moved.request.post('/api/guest/requests/service', { data: {} });
  expect(r.status()).toBe(403);
});

test('English covers the core guest flow', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'en-GB' });
  const page = await ctx.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await page.getByRole('button', { name: "Select Le Palace d'Anfa" }).click();
  await expect(page.getByRole('heading', { name: "Welcome to Le Palace d'Anfa" })).toBeVisible();
  await page.getByRole('link', { name: /Food/ }).first().click();
  await expect(page.getByRole('button', { name: 'Breakfast' })).toBeVisible();
  await page.getByRole('link', { name: 'My requests' }).click();
  await expect(page.getByText('Activate your stay to see your requests.')).toBeVisible();
  await page.getByRole('button', { name: /Français/ }).click();
  await expect(page.getByText('Activez votre séjour pour voir vos demandes.')).toBeVisible();
});
