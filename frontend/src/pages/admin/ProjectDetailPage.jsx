import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import apiClient, { getErrorMessage } from '../../api/client';
import { Card, Button, Input, Alert, Badge } from '../../components/ui';

export function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [error, setError] = useState(null);
  const [newBlockName, setNewBlockName] = useState('');
  const [blockError, setBlockError] = useState(null);

  async function load() {
    try {
      const { data } = await apiClient.get(`/admin/projects/${id}`);
      setProject(data.project);
      setBlocks(data.blocks);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleAddBlock(e) {
    e.preventDefault();
    setBlockError(null);
    if (!newBlockName.trim()) return;
    try {
      await apiClient.post(`/admin/projects/${id}/blocks`, { name: newBlockName.trim() });
      setNewBlockName('');
      await load();
    } catch (err) {
      setBlockError(getErrorMessage(err));
    }
  }

  async function handleDeleteBlock(blockId) {
    await apiClient.delete(`/admin/projects/${id}/blocks/${blockId}`);
    await load();
  }

  if (error) return <Alert>{error}</Alert>;
  if (!project) return <p className="text-sm text-slate-500">Yükleniyor...</p>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/admin/projeler" className="text-sm text-brand-700 hover:underline">
        ‹ Projeler
      </Link>

      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-slate-800">{project.name}</h1>
        <Badge variant={project.status === 'AKTIF' ? 'success' : 'default'}>{project.status}</Badge>
      </div>
      <p className="text-sm text-slate-500">
        {project.code} {project.address ? `· ${project.address}` : ''}
      </p>

      <Card>
        <h2 className="mb-3 font-semibold text-slate-800">Blok / Bölge Tanımları</h2>
        <p className="mb-3 text-sm text-slate-500">Örn: A Blok, B Blok, Otopark, Şantiye Alanı, Depo, Sosyal Tesis</p>

        {blockError && <Alert>{blockError}</Alert>}

        <form onSubmit={handleAddBlock} className="mb-4 flex gap-2">
          <div className="flex-1">
            <Input placeholder="Örn: A Blok" value={newBlockName} onChange={(e) => setNewBlockName(e.target.value)} />
          </div>
          <Button type="submit">Ekle</Button>
        </form>

        <div className="flex flex-wrap gap-2">
          {blocks.length === 0 && <p className="text-sm text-slate-400">Henüz blok/bölge tanımlanmamış.</p>}
          {blocks.map((b) => (
            <span key={b.id} className="flex items-center gap-2 rounded-full bg-slate-100 py-1.5 pl-4 pr-2 text-sm">
              {b.name}
              <button
                onClick={() => handleDeleteBlock(b.id)}
                className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-red-100 hover:text-red-600"
                aria-label={`${b.name} sil`}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}
