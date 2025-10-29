// pages/index.js
import Head from 'next/head';
import ResultFinder from '../components/ResultFinder'; // Adjust path if needed
import styles from '../styles/Home.module.css'; // Optional: for specific homepage styles

export default function Home() {
  return (
    <div className={styles.container}>
      <Head>
        <title>BEU B.Tech Result Finder</title>
        <meta name="description" content="Find Bihar Engineering University B.Tech Results quickly." />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main className={styles.main}>
        {/* You can add a header/navbar component here if you like */}
        <ResultFinder />
      </main>

      <footer className={styles.footer}>
        <p>
          Powered by{' '}
          <a href="https://beumate.app" target="_blank" rel="noopener noreferrer">
            BeuMate App (Concept)
          </a>
           | Data from BEU Official Sources
        </p>
         {/* Add disclaimer if needed */}
         <p style={{fontSize: '0.8em', color: '#6c757d', marginTop: '10px'}}>
             Disclaimer: This is an unofficial tool. Always verify results with official BEU sources. Data accuracy depends on upstream sources.
         </p>
      </footer>
    </div>
  );
}
