// pages/index.js
import Head from 'next/head';
import ResultFinder from '../components/ResultFinder';

export default function Home() {
  return (
    // Basic structure, layout controlled by globals.css
    <div>
      <Head>
        <title>BEU B.Tech Result Finder</title>
        <meta name="description" content="Find Bihar Engineering University B.Tech Results quickly." />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main> {/* Centered by globals.css */}
        <ResultFinder />
      </main>

      <footer> {/* Styled by globals.css */}
        <p>
          Powered by{' '}
          <a href="https://beumate.app" target="_blank" rel="noopener noreferrer">
            BeuMate App (Concept)
          </a>
           | Data from BEU Official Sources
        </p>
         <p style={{fontSize: '0.8em', color: '#6c757d', marginTop: '10px'}}>
             Disclaimer: This is an unofficial tool. Always verify results with official BEU sources. Data accuracy depends on upstream sources.
         </p>
      </footer>
    </div>
  );
}
