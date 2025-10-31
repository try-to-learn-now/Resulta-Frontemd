// pages/index.js
import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Home.module.css';

// --- NEW PROXY URL for BEU API ---
// REPLACE 'walla.workers.dev' with your proxy worker's domain
const BEU_EXAM_LIST_URL = 'https://resulta-exams-proxy.walla.workers.dev'; 

export default function Home() {
  const [examGroups, setExamGroups] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchExams = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(BEU_EXAM_LIST_URL); // Calls your proxy
        if (!response.ok) {
           let errData;
           try { errData = await response.json(); } catch(e) { errData = { details: await response.text() } }
           throw new Error(errData.details || `BEU API Proxy Error: ${response.status}`);
        }
        const data = await response.json();
        
        const groups = data.reduce((acc, course) => {
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
        
        setExamGroups(groups);
      } catch (err) {
        console.error("Failed to fetch exam list:", err);
        setError(`Could not load exam list: ${err.message}. Make sure the proxy worker is deployed.`);
      } finally {
        setIsLoading(false);
      }
    };
    fetchExams();
  }, []); // Empty dependency array

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

            {isLoading && <div className={styles.loader}>Loading exams...</div>}
            {error && <div className={styles.errorBox}>⚠️ {error}</div>}
            
            {!isLoading && !error && (
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
