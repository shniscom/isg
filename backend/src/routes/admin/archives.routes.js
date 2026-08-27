const express = require('express');
const { ZipArchive } = require('archiver');
const { eq, and, inArray, desc } = require('drizzle-orm');
const { db } = require('../../db/client');
const {
  archives,
  projects,
  nonconformities,
  nonconformityAssignees,
  nonconformityCorrections,
  nonconformityPhotos,
  nonconformityStatusHistory,
  penalties,
  dueDateExtensions,
  users,
  categories,
  projectBlocks,
  companies,
  employees,
} = require('../../db/schema');
const { requireSystemAdmin } = require('../../middleware/permission');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ApiError } = require('../../utils/apiError');
const { logAudit } = require('../../utils/audit');
const { getObjectStream, deleteObject } = require('../../services/storage.service');
const { assertValidPeriod, findNonconformityIdsForPeriod } = require('../../services/archive.service');

const router = express.Router();
// Arşivleme, tüm sistemi (birden fazla projeyi) kapsayan kritik bir işlem olduğundan
// yalnızca sistem admini erişebilir.
router.use(requireSystemAdmin);

/**
 * Belirtilen uygunsuzluk id'leri için tüm ilişkili verileri (atananlar, düzeltmeler,
 * fotoğraflar, tarihçe, cezalar, ek süre talepleri) toplayıp her kaydın altına gruplayarak
 * arşiv JSON'u için zenginleştirilmiş bir liste üretir.
 */
async function buildArchiveData(projectId, periodLabel, ncIds) {
  if (ncIds.length === 0) return [];

  const openedByUsers = users; // alias yardımcı okunabilirlik için

  const [ncRows, assigneeRows, correctionRows, photoRows, historyRows, penaltyRows, extensionRows] = await Promise.all([
    db
      .select({
        id: nonconformities.id,
        number: nonconformities.number,
        categoryName: categories.name,
        blockName: projectBlocks.name,
        companyName: companies.name,
        employeeFullName: employees.fullName,
        employeeNationalId: employees.nationalId,
        openedByName: openedByUsers.fullName,
        description: nonconformities.description,
        correctionSuggestion: nonconformities.correctionSuggestion,
        riskScore: nonconformities.riskScore,
        priority: nonconformities.priority,
        status: nonconformities.status,
        dueDate: nonconformities.dueDate,
        closedAt: nonconformities.closedAt,
        createdAt: nonconformities.createdAt,
        updatedAt: nonconformities.updatedAt,
      })
      .from(nonconformities)
      .leftJoin(categories, eq(nonconformities.categoryId, categories.id))
      .leftJoin(projectBlocks, eq(nonconformities.blockId, projectBlocks.id))
      .leftJoin(companies, eq(nonconformities.companyId, companies.id))
      .leftJoin(employees, eq(nonconformities.employeeId, employees.id))
      .leftJoin(openedByUsers, eq(nonconformities.openedById, openedByUsers.id))
      .where(inArray(nonconformities.id, ncIds)),
    db
      .select({ nonconformityId: nonconformityAssignees.nonconformityId, fullName: users.fullName })
      .from(nonconformityAssignees)
      .innerJoin(users, eq(nonconformityAssignees.userId, users.id))
      .where(inArray(nonconformityAssignees.nonconformityId, ncIds)),
    db
      .select({
        nonconformityId: nonconformityCorrections.nonconformityId,
        description: nonconformityCorrections.description,
        submittedByName: users.fullName,
        submittedAt: nonconformityCorrections.submittedAt,
        status: nonconformityCorrections.status,
        reviewNote: nonconformityCorrections.reviewNote,
        reviewedAt: nonconformityCorrections.reviewedAt,
      })
      .from(nonconformityCorrections)
      .leftJoin(users, eq(nonconformityCorrections.submittedById, users.id))
      .where(inArray(nonconformityCorrections.nonconformityId, ncIds)),
    db
      .select({
        id: nonconformityPhotos.id,
        nonconformityId: nonconformityPhotos.nonconformityId,
        type: nonconformityPhotos.type,
        objectKey: nonconformityPhotos.objectKey,
        originalFileName: nonconformityPhotos.originalFileName,
        uploadedByName: users.fullName,
        createdAt: nonconformityPhotos.createdAt,
      })
      .from(nonconformityPhotos)
      .leftJoin(users, eq(nonconformityPhotos.uploadedById, users.id))
      .where(inArray(nonconformityPhotos.nonconformityId, ncIds)),
    db
      .select({
        nonconformityId: nonconformityStatusHistory.nonconformityId,
        fromStatus: nonconformityStatusHistory.fromStatus,
        toStatus: nonconformityStatusHistory.toStatus,
        actorName: users.fullName,
        note: nonconformityStatusHistory.note,
        createdAt: nonconformityStatusHistory.createdAt,
      })
      .from(nonconformityStatusHistory)
      .leftJoin(users, eq(nonconformityStatusHistory.actorId, users.id))
      .where(inArray(nonconformityStatusHistory.nonconformityId, ncIds)),
    db
      .select({
        nonconformityId: penalties.nonconformityId,
        reason: penalties.reason,
        sanctionType: penalties.sanctionType,
        suggestedAmount: penalties.suggestedAmount,
        status: penalties.status,
        decisionNote: penalties.decisionNote,
        requestedAt: penalties.requestedAt,
        decidedAt: penalties.decidedAt,
      })
      .from(penalties)
      .where(inArray(penalties.nonconformityId, ncIds)),
    db
      .select({
        nonconformityId: dueDateExtensions.nonconformityId,
        currentDueDate: dueDateExtensions.currentDueDate,
        requestedNewDueDate: dueDateExtensions.requestedNewDueDate,
        reason: dueDateExtensions.reason,
        status: dueDateExtensions.status,
        decisionNote: dueDateExtensions.decisionNote,
      })
      .from(dueDateExtensions)
      .where(inArray(dueDateExtensions.nonconformityId, ncIds)),
  ]);

  function groupBy(rows) {
    const map = new Map();
    for (const row of rows) {
      const list = map.get(row.nonconformityId) || [];
      list.push(row);
      map.set(row.nonconformityId, list);
    }
    return map;
  }

  const assigneesByNc = groupBy(assigneeRows);
  const correctionsByNc = groupBy(correctionRows);
  const photosByNc = groupBy(photoRows);
  const historyByNc = groupBy(historyRows);
  const penaltiesByNc = groupBy(penaltyRows);
  const extensionsByNc = groupBy(extensionRows);

  return ncRows.map((nc) => ({
    ...nc,
    assignees: (assigneesByNc.get(nc.id) || []).map((a) => a.fullName),
    corrections: correctionsByNc.get(nc.id) || [],
    photos: (photosByNc.get(nc.id) || []).map((p) => ({
      ...p,
      // zip içindeki göreli dosya yolu; index.html bu yolu referans alır
      archiveFilePath: `photos/${nc.number.replace(/[^\w.-]+/g, '_')}/${p.id}-${(p.originalFileName || 'foto').replace(/[^\w.-]+/g, '_')}`,
    })),
    statusHistory: historyByNc.get(nc.id) || [],
    penalties: penaltiesByNc.get(nc.id) || [],
    dueDateExtensions: extensionsByNc.get(nc.id) || [],
  }));
}

const INDEX_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8" />
<title>İSG Uygunsuzluk Arşivi</title>
<style>
  body { font-family: -apple-system, Segoe UI, Arial, sans-serif; background: #f1f5f9; color: #1e293b; margin: 0; padding: 24px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .meta { color: #64748b; font-size: 13px; margin-bottom: 20px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; margin-bottom: 14px; }
  .card h3 { margin: 0 0 6px; font-size: 15px; }
  .badges span { display: inline-block; background: #eef2ff; color: #3730a3; border-radius: 999px; padding: 2px 10px; font-size: 11px; margin-right: 6px; margin-bottom: 4px; }
  .row { font-size: 12px; color: #475569; margin-top: 4px; }
  .section-title { font-weight: 600; font-size: 12px; margin-top: 10px; color: #334155; }
  .photos { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
  .photos img { width: 110px; height: 110px; object-fit: cover; border-radius: 6px; border: 1px solid #e2e8f0; }
  .search { width: 100%; max-width: 420px; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; margin-bottom: 16px; font-size: 14px; }
  ul { margin: 4px 0; padding-left: 18px; font-size: 12px; }
</style>
</head>
<body>
<h1>İSG Uygunsuzluk Arşivi</h1>
<div class="meta" id="meta"></div>
<input class="search" id="search" placeholder="Numara, açıklama veya firma ile ara..." />
<div id="list"></div>
<script>
  const DATA = __ARCHIVE_DATA__;
  document.getElementById('meta').textContent =
    DATA.projectName + ' — ' + DATA.periodLabel + ' — ' + DATA.records.length + ' kayıt — Oluşturulma: ' + new Date(DATA.generatedAt).toLocaleString('tr-TR');

  function render(records) {
    const list = document.getElementById('list');
    list.innerHTML = '';
    if (records.length === 0) { list.innerHTML = '<p>Kayıt bulunamadı.</p>'; return; }
    for (const nc of records) {
      const div = document.createElement('div');
      div.className = 'card';
      const photosHtml = (nc.photos || []).map(p => '<img src="' + p.archiveFilePath + '" alt="foto" />').join('');
      const assigneesHtml = (nc.assignees || []).join(', ') || '—';
      const historyHtml = (nc.statusHistory || []).map(h => '<li>' + (h.fromStatus || '—') + ' → ' + h.toStatus + ' (' + h.actorName + ', ' + new Date(h.createdAt).toLocaleString('tr-TR') + ')' + (h.note ? ': ' + h.note : '') + '</li>').join('');
      const correctionsHtml = (nc.corrections || []).map(c => '<li>' + c.description + ' — ' + c.status + ' (' + c.submittedByName + ')</li>').join('');
      const penaltiesHtml = (nc.penalties || []).map(p => '<li>' + p.sanctionType + ' — ' + p.status + ': ' + p.reason + '</li>').join('');
      div.innerHTML =
        '<h3>' + nc.number + '</h3>' +
        '<div class="badges"><span>' + nc.status + '</span><span>' + nc.priority + '</span></div>' +
        '<div class="row">Firma: ' + (nc.companyName || '—') + ' · Bölge: ' + (nc.blockName || '—') + ' · Kategori: ' + (nc.categoryName || '—') + '</div>' +
        '<div class="row">Çalışan: ' + (nc.employeeFullName || '—') + ' · Açan: ' + (nc.openedByName || '—') + ' · Atananlar: ' + assigneesHtml + '</div>' +
        '<div class="row">Açıklama: ' + nc.description + '</div>' +
        '<div class="row">Açıldı: ' + new Date(nc.createdAt).toLocaleString('tr-TR') + ' · Termin: ' + new Date(nc.dueDate).toLocaleString('tr-TR') + (nc.closedAt ? (' · Kapandı: ' + new Date(nc.closedAt).toLocaleString('tr-TR')) : '') + '</div>' +
        (photosHtml ? '<div class="section-title">Fotoğraflar</div><div class="photos">' + photosHtml + '</div>' : '') +
        (historyHtml ? '<div class="section-title">Durum Geçmişi</div><ul>' + historyHtml + '</ul>' : '') +
        (correctionsHtml ? '<div class="section-title">Düzeltmeler</div><ul>' + correctionsHtml + '</ul>' : '') +
        (penaltiesHtml ? '<div class="section-title">Cezalar</div><ul>' + penaltiesHtml + '</ul>' : '');
      list.appendChild(div);
    }
  }

  render(DATA.records);
  document.getElementById('search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return render(DATA.records);
    render(DATA.records.filter(nc =>
      nc.number.toLowerCase().includes(q) ||
      (nc.description || '').toLowerCase().includes(q) ||
      (nc.companyName || '').toLowerCase().includes(q)
    ));
  });
</script>
</body>
</html>`;

// GET /admin/archives?projectId=... -> mevcut arşiv kayıtlarının listesi
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { projectId } = req.query;
    const rows = await db
      .select({
        id: archives.id,
        projectId: archives.projectId,
        projectName: projects.name,
        periodLabel: archives.periodLabel,
        recordCount: archives.recordCount,
        status: archives.status,
        createdByName: users.fullName,
        createdAt: archives.createdAt,
        deletedAt: archives.deletedAt,
      })
      .from(archives)
      .leftJoin(projects, eq(archives.projectId, projects.id))
      .leftJoin(users, eq(archives.createdById, users.id))
      .where(projectId ? eq(archives.projectId, projectId) : undefined)
      .orderBy(desc(archives.createdAt));
    res.json({ archives: rows });
  })
);

// GET /admin/archives/preview?projectId=&periodLabel= -> arşivlenecek kayıt sayısını gösterir
router.get(
  '/preview',
  asyncHandler(async (req, res) => {
    const { projectId, periodLabel } = req.query;
    if (!projectId) throw ApiError.badRequest('projectId zorunludur.');
    assertValidPeriod(periodLabel);
    const ids = await findNonconformityIdsForPeriod(projectId, periodLabel);

    const [existing] = await db
      .select()
      .from(archives)
      .where(and(eq(archives.projectId, projectId), eq(archives.periodLabel, periodLabel)))
      .limit(1);

    res.json({ recordCount: ids.length, existingArchive: existing || null });
  })
);

// GET /admin/archives/generate?projectId=&periodLabel= -> tüm dönem verisini + fotoğrafları zip olarak indirir
router.get(
  '/generate',
  asyncHandler(async (req, res) => {
    const { projectId, periodLabel } = req.query;
    if (!projectId) throw ApiError.badRequest('projectId zorunludur.');
    assertValidPeriod(periodLabel);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) throw ApiError.notFound('Proje bulunamadı.');

    const ncIds = await findNonconformityIdsForPeriod(projectId, periodLabel);
    const records = await buildArchiveData(projectId, periodLabel, ncIds);

    const archiveData = {
      projectId,
      projectName: project.name,
      periodLabel,
      generatedAt: new Date().toISOString(),
      recordCount: records.length,
      records,
    };

    // Zip akışını doğrudan response'a yönlendir (sunucuda geçici dosya oluşturmaz).
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="arsiv_${project.code || project.name}_${periodLabel}.zip"`.replace(/\s+/g, '_')
    );

    const archive = new ZipArchive({ zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[archives] zip oluşturma hatası:', err.message);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    archive.pipe(res);

    archive.append(JSON.stringify(archiveData, null, 2), { name: 'data.json' });
    archive.append(INDEX_HTML_TEMPLATE.replace('__ARCHIVE_DATA__', JSON.stringify(archiveData)), { name: 'index.html' });

    // Fotoğrafları R2'den çekip zip'e ekle (foto başına best-effort; biri başarısız olursa
    // diğerlerini engellemez).
    for (const nc of records) {
      for (const photo of nc.photos) {
        try {
          const stream = await getObjectStream(photo.objectKey);
          archive.append(stream, { name: photo.archiveFilePath });
        } catch (err) {
          console.error(`[archives] fotoğraf indirilemedi (${photo.objectKey}):`, err.message);
        }
      }
    }

    // Arşiv kaydını oluştur/güncelle: bu dönem için üretim yapıldığını işaretler (henüz silme yok).
    const [existing] = await db
      .select()
      .from(archives)
      .where(and(eq(archives.projectId, projectId), eq(archives.periodLabel, periodLabel)))
      .limit(1);

    if (existing) {
      if (existing.status !== 'SILINDI') {
        await db
          .update(archives)
          .set({ recordCount: records.length, createdById: req.user.sub, createdAt: new Date() })
          .where(eq(archives.id, existing.id));
      }
    } else {
      await db.insert(archives).values({
        projectId,
        periodLabel,
        recordCount: records.length,
        status: 'OLUSTURULDU',
        createdById: req.user.sub,
      });
    }

    await logAudit({
      userId: req.user.sub,
      action: 'ARCHIVE_GENERATE',
      entityType: 'archive',
      entityId: `${projectId}:${periodLabel}`,
      details: { recordCount: records.length },
    });

    archive.finalize();
  })
);

// POST /admin/archives/:id/confirm-delete -> arşivi kaydettiğini onaylayan admin, o döneme
// ait verileri (fotoğraflar dahil) sunucudan kalıcı olarak siler.
router.post(
  '/:id/confirm-delete',
  asyncHandler(async (req, res) => {
    const [archiveRow] = await db.select().from(archives).where(eq(archives.id, req.params.id)).limit(1);
    if (!archiveRow) throw ApiError.notFound('Arşiv kaydı bulunamadı.');
    if (archiveRow.status === 'SILINDI') {
      throw ApiError.conflict('Bu arşivin verileri zaten sunucudan silinmiş.');
    }

    const ncIds = await findNonconformityIdsForPeriod(archiveRow.projectId, archiveRow.periodLabel);

    let deletedPhotoCount = 0;
    let photoDeleteFailures = 0;
    if (ncIds.length > 0) {
      const photoRows = await db
        .select({ objectKey: nonconformityPhotos.objectKey })
        .from(nonconformityPhotos)
        .where(inArray(nonconformityPhotos.nonconformityId, ncIds));

      for (const { objectKey } of photoRows) {
        try {
          await deleteObject(objectKey);
          deletedPhotoCount++;
        } catch (err) {
          photoDeleteFailures++;
          console.error(`[archives] fotoğraf silinemedi (${objectKey}):`, err.message);
        }
      }

      // nonconformities silindiğinde ilişkili tüm alt kayıtlar (atananlar, düzeltmeler,
      // fotoğraf kayıtları, tarihçe, cezalar, ek süre talepleri, bildirimler) cascade ile silinir.
      await db.delete(nonconformities).where(inArray(nonconformities.id, ncIds));
    }

    await db
      .update(archives)
      .set({ status: 'SILINDI', deletedById: req.user.sub, deletedAt: new Date() })
      .where(eq(archives.id, archiveRow.id));

    await logAudit({
      userId: req.user.sub,
      action: 'ARCHIVE_CONFIRM_DELETE',
      entityType: 'archive',
      entityId: archiveRow.id,
      details: { deletedRecordCount: ncIds.length, deletedPhotoCount, photoDeleteFailures },
    });

    res.json({ deletedRecordCount: ncIds.length, deletedPhotoCount, photoDeleteFailures });
  })
);

module.exports = router;
