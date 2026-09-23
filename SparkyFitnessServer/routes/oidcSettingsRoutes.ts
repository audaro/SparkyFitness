import express from 'express';
import { log } from '../config/logging.js';
import { isAdmin } from '../middleware/authMiddleware.js';
import oidcLogoUpload from '../middleware/oidcLogoUpload.js';
import oidcProviderRepository from '../models/oidcProviderRepository.js';
import { oidcProviderUpdateSchema } from '../schemas/oidcProviderSchemas.js';
const router = express.Router();
/**
 * @swagger
 * /admin/oidc-settings:
 *   get:
 *     summary: Get all OIDC Providers (Admin Only)
 */
router.get('/', isAdmin, async (req, res) => {
  try {
    const providers = await oidcProviderRepository.getOidcProviders();
    res.json(providers);
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    log('error', `[OIDC SETTINGS] GET Error: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving OIDC providers' });
  }
});
/**
 * @swagger
 * /admin/oidc-settings/{id}:
 *   get:
 *     summary: Get a single OIDC Provider by ID (Admin Only)
 */
router.get('/:id', isAdmin, async (req, res) => {
  try {
    const provider = await oidcProviderRepository.getOidcProviderById(
      req.params.id
    );
    if (provider) {
      res.json({ ...provider, client_secret: undefined });
    } else {
      res.status(404).json({ message: 'OIDC provider not found' });
    }
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    log('error', `[OIDC SETTINGS] GET/:id Error: ${error.message}`);
    res.status(500).json({ message: 'Error retrieving OIDC provider' });
  }
});
/**
 * @swagger
 * /admin/oidc-settings:
 *   post:
 *     summary: Create a new OIDC Provider (Admin Only)
 */
router.post('/', isAdmin, async (req, res) => {
  try {
    const result = await oidcProviderRepository.createOidcProvider(req.body);
    log('info', `[OIDC SETTINGS] Provider created with ID: ${result.id}`);
    res
      .status(201)
      .json({ message: 'OIDC provider created successfully', id: result.id });
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    log('error', `[OIDC SETTINGS] POST Error: ${error.message}`);
    res
      .status(500)
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      .json({ message: 'Error creating OIDC provider: ' + error.message });
  }
});
/**
 * @swagger
 * /admin/oidc-settings/{id}:
 *   put:
 *     summary: Update an OIDC Provider (Admin Only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - issuer_url
 *               - client_id
 *             properties:
 *               issuer_url:
 *                 type: string
 *                 minLength: 1
 *               client_id:
 *                 type: string
 *                 minLength: 1
 *                 nullable: true
 *                 description: Null retains the stored client ID; a usable stored ID is required.
 *               client_secret:
 *                 type: string
 *                 nullable: true
 *               provider_id:
 *                 type: string
 *               domain:
 *                 type: string
 *                 description: Retains the stored domain when omitted.
 *               display_name:
 *                 type: string
 *                 nullable: true
 *               logo_url:
 *                 type: string
 *                 nullable: true
 *               auto_register:
 *                 type: boolean
 *               is_active:
 *                 type: boolean
 *               redirect_uris:
 *                 type: array
 *                 items:
 *                   type: string
 *               response_types:
 *                 type: array
 *                 items:
 *                   type: string
 *               token_endpoint_auth_method:
 *                 type: string
 *               signing_algorithm:
 *                 type: string
 *               profile_signing_algorithm:
 *                 type: string
 *               timeout:
 *                 type: number
 *               is_env_configured:
 *                 type: boolean
 *               admin_group:
 *                 type: string
 *                 nullable: true
 *               scope:
 *                 type: string
 *                 nullable: true
 *     responses:
 *       200:
 *         description: OIDC provider updated successfully.
 *       400:
 *         description: Invalid OIDC provider settings.
 *       404:
 *         description: OIDC provider not found.
 *       500:
 *         description: Error updating OIDC provider.
 */
router.put('/:id', isAdmin, async (req, res) => {
  const parsed = oidcProviderUpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid OIDC provider settings.' });
  }
  try {
    await oidcProviderRepository.updateOidcProvider(req.params.id, parsed.data);
    log('info', `[OIDC SETTINGS] Provider ${req.params.id} updated.`);
    res.status(200).json({ message: 'OIDC provider updated successfully' });
  } catch (error) {
    if (error instanceof Error && error.message === 'OIDC provider not found') {
      return res.status(404).json({ message: error.message });
    }
    if (
      error instanceof Error &&
      error.message === 'OIDC client ID is required'
    ) {
      return res.status(400).json({ message: error.message });
    }
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    log('error', `[OIDC SETTINGS] PUT Error: ${error.message}`);
    res
      .status(500)
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      .json({ message: 'Error updating OIDC provider: ' + error.message });
  }
});
/**
 * @swagger
 * /admin/oidc-settings/{id}:
 *   delete:
 *     summary: DELETE an OIDC Provider (Admin Only)
 */
router.delete('/:id', isAdmin, async (req, res) => {
  try {
    await oidcProviderRepository.deleteOidcProvider(req.params.id);
    res.status(200).json({ message: 'OIDC provider deleted successfully' });
  } catch (error) {
    // @ts-expect-error TS(2571): Object is of type 'unknown'.
    log('error', `[OIDC SETTINGS] DELETE Error: ${error.message}`);
    res.status(500).json({ message: 'Error deleting OIDC provider' });
  }
});
/**
 * @swagger
 * /admin/oidc-settings/{id}/logo:
 *   post:
 *     summary: POST a logo for an OIDC Provider (Admin Only)
 */
router.post(
  '/:id/logo',
  isAdmin,
  oidcLogoUpload.single('logo'),
  async (req, res) => {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ message: 'No logo file uploaded.' });
    }
    try {
      const logoUrl = `/uploads/oidc/${req.file.filename}`;
      const success = await oidcProviderRepository.setProviderLogo(id, logoUrl);
      if (success) {
        res
          .status(200)
          .json({ message: 'Logo uploaded successfully', logoUrl });
      } else {
        res.status(404).json({ message: 'OIDC provider not found' });
      }
    } catch (error) {
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      log('error', `[OIDC SETTINGS] LOGO Error: ${error.message}`);
      res.status(500).json({ message: 'Error uploading logo' });
    }
  }
);
export default router;
