import { Link, useNavigate, useParams } from 'react-router-dom';
import UserAvatar from '../../components/UserAvatar.jsx';
import { useStore } from '../../store/useStore';
import { deleteBuild, getBuild, likeBuild } from '../../api/gameHub';
import { HubPage } from './GameHubShell.jsx';
import { EmptyState, Ico, agoLabel, errText, useLoad } from './shared.jsx';
import {
  BuildPortrait, DARKTIDE_CLASSES, DL_SLOTS, Icon, LOL_ROLES, gameMeta, useGameData, useIndex, useLolChampion,
} from './buildsShared.jsx';

// Game Hub → uma build (/jogos/builds/:id).

const notice = (m) => useStore.getState().pushNotice(m);

function ItemRow({ title, ids, index, slotOf = false }) {
  if (!ids?.length) return null;
  return (
    <div className="gh-bv-items">
      <h3 className="gh-bv-h3">{title}</h3>
      <ol className="gh-bv-itemlist">
        {ids.map((id, i) => {
          const it = index?.item.get(slotOf ? Number(id) : String(id));
          return (
            <li key={`${id}-${i}`}>
              <Icon src={it?.img} name={it?.name || String(id)} size={46} slot={slotOf ? it?.slot : undefined} />
              <span className="gh-bv-itemname">{it?.name || id}{slotOf && it ? <small>{it.cost?.toLocaleString('pt-BR')} almas</small> : it?.gold ? <small>{it.gold} de ouro</small> : null}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function SkillGrid({ skills, champ }) {
  if (!skills) return null;
  const rows = ['Q', 'W', 'E', 'R'];
  return (
    <div className="gh-skills" role="table" aria-label="Ordem de habilidades por nível">
      {rows.map((k) => {
        const s = champ?.spells?.find((x) => x.key === k);
        return (
          <div key={k} className="gh-skills-row" role="row">
            <span className="gh-skills-key" role="rowheader">{s ? <Icon src={s.img} name={`${k} — ${s.name}`} size={28} /> : null}<b>{k}</b></span>
            {Array.from({ length: 18 }, (_, i) => <span key={i} role="cell" className={`gh-skills-cell${skills[i] === k ? ' on' : ''}`}>{skills[i] === k ? i + 1 : ''}</span>)}
          </div>
        );
      })}
    </div>
  );
}

function LolBody({ build, index }) {
  const d = build.data;
  const champ = useLolChampion(build.hero);
  const primary = index?.tree.get(d.primaryTree);
  const secondary = index?.tree.get(d.secondaryTree);
  const key = index?.rune.get(d.keystone);
  return (
    <>
      <section className="gh-bv-block gh-bv-pills">
        {(primary || key) && (
          <div className="gh-bv-pill"><span className="gh-bv-pill-h">Runas</span>
            <span className="gh-bv-pill-row">
              {key && <Icon src={key.img} name={key.name} size={44} round />}
              {primary && <Icon src={primary.img} name={primary.name} size={28} round />}
              {secondary && <Icon src={secondary.img} name={`Secundária: ${secondary.name}`} size={28} round />}
              <span className="gh-bv-pill-txt">{[key?.name, primary?.name, secondary && `+ ${secondary.name}`].filter(Boolean).join(' · ')}</span>
            </span>
          </div>
        )}
        {d.spells?.length > 0 && (
          <div className="gh-bv-pill"><span className="gh-bv-pill-h">Feitiços</span>
            <span className="gh-bv-pill-row">{d.spells.map((id) => { const s = index?.spell.get(id); return <Icon key={id} src={s?.img} name={s?.name || id} size={36} />; })}
              <span className="gh-bv-pill-txt">{d.spells.map((id) => index?.spell.get(id)?.name || id).join(' + ')}</span></span>
          </div>
        )}
      </section>
      <section className="gh-bv-block">
        <ItemRow title="Iniciais" ids={d.start} index={index} />
        <ItemRow title="Principais (em ordem)" ids={d.core} index={index} />
        <ItemRow title="Situacionais" ids={d.situational} index={index} />
      </section>
      {d.skills && (
        <section className="gh-bv-block">
          <h3 className="gh-bv-h3">Ordem de habilidades</h3>
          <SkillGrid skills={d.skills} champ={champ} />
        </section>
      )}
    </>
  );
}

function DeadlockBody({ build, index }) {
  const d = build.data;
  const hero = index?.hero.get(Number(build.hero));
  return (
    <>
      {d.abilityOrder?.length > 0 && hero && (
        <section className="gh-bv-block">
          <h3 className="gh-bv-h3">Prioridade das habilidades</h3>
          <ol className="gh-dl-order">
            {d.abilityOrder.map((slot, i) => { const a = hero.abilities.find((x) => x.slot === slot); return <li key={slot}><b>{i + 1}º</b><Icon src={a?.img} name={a?.name || `Habilidade ${slot}`} size={40} round /><span>{a?.name}</span></li>; })}
          </ol>
        </section>
      )}
      <section className="gh-bv-block">
        <ItemRow title="Começo da partida" ids={d.early} index={index} slotOf />
        <ItemRow title="Meio" ids={d.mid} index={index} slotOf />
        <ItemRow title="Fim" ids={d.late} index={index} slotOf />
        <p className="gh-legend">{DL_SLOTS.map((s) => <span key={s.id} className={`dl-${s.id}`}><i />{s.name}</span>)}</p>
      </section>
    </>
  );
}

function TextBody({ rows }) {
  const list = rows.filter(([, v]) => (Array.isArray(v) ? v.some(Boolean) : v));
  if (!list.length) return null;
  return (
    <section className="gh-bv-block">
      <dl className="gh-bv-dl">
        {list.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{Array.isArray(v) ? <ul>{v.filter(Boolean).map((x, i) => <li key={i}>{x}</li>)}</ul> : v}</dd></div>
        ))}
      </dl>
    </section>
  );
}

export default function BuildView() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: build, error, loading, setData } = useLoad(() => getBuild(id), [id]);
  const { data: gameData } = useGameData(build?.game);
  const index = useIndex(build?.game, gameData);
  if (loading && !build) return <HubPage><span className="gh-skel gh-bv-skel" /></HubPage>;
  if (error || !build) {
    return <HubPage><EmptyState icon="hammer" title="Build não encontrada" action={<Link className="gh-btn" to="/jogos/builds">Ver builds</Link>}>Ela pode ter sido apagada.</EmptyState></HubPage>;
  }
  const meta = gameMeta(build.game);
  const d = build.data || {};
  const like = async () => {
    try { const r = await likeBuild(build.id); setData((b) => ({ ...b, liked: r.liked, likesCount: r.likesCount })); } catch (err) { notice(errText(err, 'Não deu pra curtir agora.')); }
  };
  const remove = async () => {
    if (!window.confirm('Apagar essa build?')) return;
    try { await deleteBuild(build.id); notice('Build apagada.'); navigate('/jogos/builds'); } catch (err) { notice(errText(err, 'Não consegui apagar.')); }
  };
  const subtitle = build.game === 'lol'
    ? [index?.champ.get(build.hero)?.name || build.hero, LOL_ROLES.find((r) => r.id === build.role)?.name].filter(Boolean).join(' · ')
    : build.game === 'deadlock' ? index?.hero.get(Number(build.hero))?.name
      : build.game === 'darktide' ? DARKTIDE_CLASSES.find((c) => c.id === build.hero)?.name
        : [build.gameInfo?.name, build.heroName].filter(Boolean).join(' · ');
  return (
    <HubPage className={`gh-bv g-${build.game}`}>
      <Link to={`/jogos/builds?jogo=${build.game}`} className="gh-back"><Ico name="back" size={16} /> Builds de {meta.short}</Link>
      <header className="gh-bv-head">
        <BuildPortrait build={build} index={index} size={84} />
        <div className="gh-bv-titles">
          <span className="gh-bcard-game">{meta.name}</span>
          <h1 className="gh-h1">{build.title}</h1>
          <p className="gh-sub">{subtitle}</p>
          <p className="gh-bv-by">{build.author && <><UserAvatar user={build.author} size={22} /> {build.author.displayName}</>} · {agoLabel(build.updatedAt || build.createdAt)}</p>
        </div>
        <div className="gh-bv-actions">
          <button type="button" className={`gh-btn${build.liked ? ' is-liked' : ''}`} aria-pressed={build.liked} onClick={like}><Ico name="heart" size={16} /> {build.likesCount || 0}</button>
          {build.mine && <Link className="gh-btn" to={`/jogos/builds/${build.id}/editar`}><Ico name="edit" size={15} /> Editar</Link>}
          {build.mine && <button type="button" className="gh-btn is-quiet" onClick={remove}><Ico name="trash" size={15} /></button>}
        </div>
      </header>

      {build.game === 'lol' && <LolBody build={build} index={index} />}
      {build.game === 'deadlock' && <DeadlockBody build={build} index={index} />}
      {build.game === 'darktide' && (
        <TextBody rows={[['Corpo a corpo', d.melee], ['Distância', d.ranged], ['Bênçãos', d.blessings], ['Talentos', d.talents], ['Curios', d.curios]]} />
      )}
      {build.game === 'outro' && <TextBody rows={[['Personagem / classe', d.character], ['Itens', d.items], ['Habilidades', d.abilities]]} />}
      {build.notes && (
        <section className="gh-bv-block">
          <h3 className="gh-bv-h3">Como jogar</h3>
          <p className="gh-bv-notes">{build.notes}</p>
        </section>
      )}
    </HubPage>
  );
}
