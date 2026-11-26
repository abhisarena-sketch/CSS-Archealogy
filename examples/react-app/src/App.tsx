import clsx from 'clsx';
import { Button } from './components/Button';

type Tone = 'info' | 'warning' | 'danger';

export function App({ tone, compact }: { tone: Tone; compact: boolean }) {
  return (
    <div className={clsx('app', { 'app--compact': compact })}>
      <p className={`alert alert-${tone}`}>Heads up</p>
      <Button variant="primary">Save</Button>
    </div>
  );
}
