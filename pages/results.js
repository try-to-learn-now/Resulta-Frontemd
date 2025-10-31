// pages/results.js
import React from 'react'; // <-- ADDED IMPORT
import Head from 'next/head';
import { useRouter } from 'next/router';
import ResultFinder from '../components/ResultFinder';
import Link from 'next/link';

export default function ResultsPage() {
  const router = useRouter();
  const { examId } = router.query;

  return (
    <>
      <Head>
        <title>Find B.Tech Results</title>
        <meta name="description" content="Find Bihar Engineering University B.Tech Results quickly." />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <div style={{ padding: '10px 15px', fontSize: '0.9em' }}>
          <Link href="/">
            <a>&larr; Back to all Exam Lists</a>
          </Link>
        </div>
        {examId ? (
            <ResultFinder selectedExamIdProp={examId.toString()} />
        ) : (
             <div style={{textAlign: 'center', padding: '40px 20px'}}>
                <h2>Loading...</h2>
                <p>Waiting for exam details.</p>
                <p>If this takes too long, <Link href="/"><a>go back and select an exam</a></Link>.</p>
             </div>
        )}
      </main>
      <footer> {/* Empty footer */} </footer>
    </>
  );
}
