// Kritik/geri dönülmez bir işlemi admin ise ANINDA uygular; admin değilse pending_approvals'a
// kuyruğa alır ve 202 döner. Gerçek işlem mantığı services/criticalActions.service.js EXECUTORS
// içindedir; bu dosya yalnızca "hemen mi, onaya mı" yönlendirmesini yapar.
const { db } = require('../db/client');
const { pendingApprovals } = require('../db/schema');
const { EXECUTORS } = require('../services/criticalActions.service');

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {object} opts
 * @param {string} opts.actionType - EXECUTORS içindeki anahtarlardan biri, örn. 'COMPANY_DELETE'.
 * @param {string} opts.entityType - örn. 'company', 'project', 'nonconformity', 'penalty'.
 * @param {string} opts.entityId
 * @param {object} opts.payload - onaylandığında executor'a aynen geçirilecek veri.
 * @param {string} opts.summary - admin onay ekranında gösterilecek insan-okunur özet.
 * @param {string} [opts.projectId]
 */
async function runOrQueueForApproval(req, res, { actionType, entityType, entityId, payload, summary, projectId }) {
  const executor = EXECUTORS[actionType];
  if (!executor) throw new Error(`Bilinmeyen kritik işlem tipi: ${actionType}`);

  if (req.user.isSystemAdmin) {
    const result = await executor(payload, req.user.sub);
    res.json(result);
    return;
  }

  const [created] = await db
    .insert(pendingApprovals)
    .values({
      actionType,
      entityType,
      entityId,
      payload,
      summary,
      projectId: projectId || null,
      requestedById: req.user.sub,
    })
    .returning();

  res.status(202).json({
    queued: true,
    approval: created,
    message: 'Bu işlem, geri dönülemez/kritik olduğu için admin onayına gönderildi. Admin onayladığında uygulanacaktır.',
  });
}

module.exports = { runOrQueueForApproval };
