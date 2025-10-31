// pages/index.js
import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Home.module.css';

// --- IMPORTANT ---
// We call your PROXY WORKER to stay in sync with the results page.
const PROXY_EXAM_LIST_URL = 'https://resulta-exams-proxy.walla.workers.dev'; 

/**
 * This is the SERVER-SIDE function.
 * It runs once at build time to create an instant static page.
 * It will run again ONLY when you hit your secret API.
 */
export async function getStaticProps() {
  console.log("SERVER: Building static page from PROXY...");
  let examGroups = [];
  let error = null;

  try {
    // We call the PROXY, not the real BEU API.
    const response = await fetch(PROXY_EXAM_LIST_URL); 
    
    if (!response.ok) {
       throw new Error(`Proxy Worker Error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // This is your same good logic from the original file
    examGroups = data.reduce((acc, course) => {
        if (course.exams && course.exams.length > 0) {
            const sortedExams = [...course.exams].sort((a, b) => {
                 if(a.semId !== b.semId) return b.semId - a.semId;
                 return a.examName.localeCompare(b.examName);
            });
            acc.push({
                courseName: course.courseName,
                exams: sortedExams
            });
        }
        return acc;
    }, []);

  } catch (err) {
    console.error("Failed to fetch exam list from proxy:", err);
    error = `Could not load exam list: ${err.message}.`;
  }

  // Pass data to the 'Home' component
  return {
    props: {
      examGroups,
      error,
    },
    // NO 'revalidate' KEY! This is now 100% manual.
  };
}

/**
 * This is your normal 'Home' component.
 * It is fast because it gets 'examGroups' as a prop.
 */
export default function Home({ examGroups, error }) {
  // ... (All your HTML/JSX is the same as before) ...
  return (
    <>
      <Head>
        <title>BEU Examination Results</title>
        <meta name="description" content="Select your examination to view results." />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <div className={styles.container}>
            <h1 className={styles.title}>Examination Results</h1>
            <p className={styles.subtitle}>(Select a B.Tech exam below to access results)</p>

            {/* No loader needed, page is instant */}
            {error && <div className={styles.errorBox}>⚠️ {error}</div>}
            
            {!error && (
                <div className={styles.examTableContainer}>
                    <table className={styles.examTable}>
                        <thead>
                            <tr>
                                <th>Examinations Name</th>
                                <th>Batch / Session</th>
                                <th>Exam Held</th>
                                <th>Published Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            {examGroups.map(group => (
                                <React.Fragment key={group.courseName}>
                                    <tr className={styles.courseHeaderRow}>
                                        <td colSpan="4">{group.courseName}</td>
                                    </tr>
                                    {group.exams.map(exam => (
                                        <tr 
                                            key={exam.id} 
                                            className={`${styles.examRow} ${group.courseName === 'B.Tech' ? styles.examRowBTech : ''}`}
                                        >
                                            <td className={styles.examName}>
                                                {group.courseName === 'B.Tech' ? (
                                                    <Link href={`/results?examId=${exam.id}`} passHref>
                                                        <a>{exam.examName}</a>
                                                    </Link>
                                                ) : (
                                                    exam.examName
                                                )}
                                            </td>
                                            <td className={styles.batchSession}>{exam.session}</td>
                                            <td className={styles.examHeld}>{exam.examHeld}</td>
                                            <td className={styles.publishedDate}>
                                                {exam.publishDate ? new Date(exam.publishDate).toLocaleDateString('en-GB') : 'N/A'}
                                            </td>
                                        </tr>
                                    ))}
                                </React.Fragment>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
      </main>

      <footer> {/* Empty footer */} </footer>
    </>
  );
}
