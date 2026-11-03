import { useSearchParams } from 'react-router-dom';
import { PageHero, PillTabs } from '../components/PagesKit.jsx';
import PlayGroupsTab from '../components/community/PlayGroupsTab.jsx';
import ReferralsTab from '../components/community/ReferralsTab.jsx';
import InterestsTab from '../components/community/InterestsTab.jsx';
import MentorsTab from '../components/community/MentorsTab.jsx';
import ReputationTab from '../components/community/ReputationTab.jsx';
import '../styles/community4.css';

// "Participar": tudo que é de convivência na comunidade num lugar só —
// Bora Jogar, convites, interesses, padrinhos e reputação. Cada aba tem
// link próprio (/participar?aba=...), usado nos avisos.
const TABS = [
  { id: 'jogar', label: 'Bora Jogar', icon: 'bolt', Page: PlayGroupsTab },
  { id: 'interesses', label: 'Interesses', icon: 'tag', Page: InterestsTab },
  { id: 'reputacao', label: 'Reputação', icon: 'heart', Page: ReputationTab },
  { id: 'padrinhos', label: 'Padrinhos', icon: 'shield', Page: MentorsTab },
  { id: 'convites', label: 'Convites', icon: 'gift', Page: ReferralsTab },
];

export default function ParticiparPage() {
  const [params, setParams] = useSearchParams();
  const tab = TABS.find((t) => t.id === params.get('aba')) || TABS[0];
  const { Page } = tab;
  return (
    <div className="pk-page c4-page">
      <div className="pk-inner narrow">
        <PageHero icon="users" eyebrow="Comunidade" title="Participar" desc="Jogue junto, encontre gente com os mesmos interesses, agradeça quem ajuda e traga seus amigos." />
        <PillTabs tabs={TABS} value={tab.id} label="Seções" onChange={(id) => setParams(id === TABS[0].id ? {} : { aba: id }, { replace: true })} />
        <div className="c4-tab-body" key={tab.id}><Page /></div>
      </div>
    </div>
  );
}
