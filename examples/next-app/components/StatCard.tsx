import styles from './StatCard.module.css';

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.card}>
      <span className={styles.label}>{label}</span>
      <strong className={styles['value-text']}>{value}</strong>
    </div>
  );
}
