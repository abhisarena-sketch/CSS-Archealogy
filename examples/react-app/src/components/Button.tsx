import styles from './Button.module.css';

export function Button({ variant, children }: { variant: 'primary' | 'secondary'; children: React.ReactNode }) {
  return <button className={`${styles.button} ${variant === 'primary' ? styles.primary : styles.secondary}`}>{children}</button>;
}
