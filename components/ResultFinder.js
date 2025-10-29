// components/ResultFinder.js
import React, { useState, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import styles from '../styles/ResultFinder.module.css'; // Using CSS Modules

// --- Configuration: Your Final Cloudflare Worker URLs ---
// IMPORTANT: Replace with your actual deployed worker URLs
const WORKER_URLS = {
    user: "https://resulta-user.walla.workers.dev/api/result", // Replace beunotes.workers.dev
    reg1: "https://resulta-reg1.walla.workers.dev/api/result",
    reg2: "https://resulta-reg2.walla.workers.dev/api/result",
    le:   "https://resulta-le.walla.workers.dev/api/result",
};
const BEU_EXAM_LIST_URL = 'https://beu-bih.ac.in/backend/v1/result/sem-get';

// --- Helper Maps ---
const arabicToRomanMap = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII' };
const romanToArabicMap = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
const getRomanSemester = (semId) => arabicToRomanMap[semId] || '';
const getArabicSemester = (roman) => roman ? romanToArabicMap[roman.toUpperCase()] || 0 : 0;

/**
 * --- Helper Function to Fetch from a Worker ---
 * Fetches data, ensures response is an array, handles errors consistently.
 */
async function fetchWorkerData(workerKey, params) {
    const url = `${WORKER_URLS[workerKey]}?${params}`;
    console.log(`Fetching from ${workerKey}...`);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            let errorReason = `Worker ${workerKey} request failed: ${response.status}`;
            try {
                const errorJson = await response.json();
                errorReason = errorJson.error || (Array.isArray(errorJson) && errorJson[0]?.reason) || errorReason;
            } catch (e) { /* Ignore */ }
            throw new Error(errorReason);
        }
        const data = await response.json();
        if (!Array.isArray(data)) {
            console.error(`Non-array response from ${workerKey}:`, data);
            throw new Error(`Worker ${workerKey} returned invalid data format.`);
        }
        console.log(`Received ${data.length} results from ${workerKey}`);
        return data;
    } catch (error) {
        console.error(`Error fetching from ${workerKey} (${url}):`, error);
         const baseRegNo = params.split('&')[0].split('=')[1] || 'Unknown';
         const batchSize = 5; // Assuming batch size
         const baseNum = parseInt(baseRegNo.slice(-3)) || 0;
         const batchRegNos = Array.from({ length: batchSize }, (_, i) => `${baseRegNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
         return batchRegNos.map(rn => ({ regNo: rn, status: 'Error', reason: error.message })); // Return error structure
    }
}


// --- Main Component ---
const ResultFinder = () => {
    // --- State ---
    const [allExams, setAllExams] = useState([]);
    const [btechExams, setBtechExams] = useState([]);
    const [selectedExamId, setSelectedExamId] = useState('');
    const [regNo, setRegNo] = useState('');

    const [userResult, setUserResult] = useState(null); // Just the user's result object
    const [classResults, setClassResults] = useState([]); // Filtered results for table
    const [isLoading, setIsLoading] = useState(false); // Initial user fetch
    const [loadingStage, setLoadingStage] = useState(''); // Text for loading status
    const [error, setError] = useState(null);
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [lastSearchParams, setLastSearchParams] = useState(null); // For retry
    const [showLoadMore, setShowLoadMore] = useState(false); // Show/hide Load More button
    const [isLoadingMore, setIsLoadingMore] = useState(false); // Loading state for Reg2 fetch
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedStudentData, setSelectedStudentData] = useState(null);
    const [fetchedReg2, setFetchedReg2] = useState(false); // Track if reg2 was loaded

    // --- Fetch Exam List ---
    useEffect(() => {
        const fetchExams = async () => { /* ... (Same as before) ... */
             setError(null); console.log("Fetching exam list...");
            try {
                const response = await fetch(BEU_EXAM_LIST_URL); if (!response.ok) throw new Error(`BEU API Error: ${response.status}`);
                const data = await response.json(); setAllExams(data);
                const btechCourse = data.find(c => c.courseName === "B.Tech");
                if (btechCourse?.exams) {
                    const sorted = [...btechCourse.exams].sort((a, b) => (a.semId !== b.semId) ? b.semId - a.semId : a.examName.localeCompare(b.examName));
                    setBtechExams(sorted); if (sorted.length > 0) setSelectedExamId(sorted[0].id.toString()); else setError("No B.Tech exams found.");
                    console.log("Exam list loaded.");
                } else { setError("B.Tech course/exams not found."); }
            } catch (err) { console.error("Failed fetch exam list:", err); setError(`Could not load exam list: ${err.message}`); }
        };
        fetchExams();
    }, []);

    // --- Get Selected Exam Details ---
    const getSelectedExamDetails = useCallback(() => { /* ... (Same as before) ... */
         let exam = btechExams.find(exam => exam.id.toString() === selectedExamId);
        if (!exam) { for (const course of allExams) { exam = course.exams.find(ex => ex.id.toString() === selectedExamId); if (exam) break; } }
        return exam;
    }, [btechExams, selectedExamId, allExams]);

     // --- Merge, Unique, Sort Helper - Filters "Record not found" ---
     const mergeAndSortResults = (existingResults, newResults) => {
         const resultMap = new Map(existingResults.map(item => [item.regNo || `error-${Math.random()}`, item]));
         newResults.forEach(item => {
             // Exclude "Record not found" UNLESS it's the specific user being searched
             if (item.status !== 'Record not found' || item.regNo === regNo) {
                 const existing = resultMap.get(item.regNo);
                 // Prioritize non-error status if merging duplicates
                 if (!existing || (existing.status === 'Error' && item.status !== 'Error') || !item.regNo) {
                    resultMap.set(item.regNo || `error-${Math.random()}`, item);
                 }
             } else {
                 // If it's "Record not found" and NOT the searched user, remove it if it existed previously
                 if (resultMap.has(item.regNo)) {
                     resultMap.delete(item.regNo);
                 }
             }
         });
         // Convert back to array and sort
         return Array.from(resultMap.values()).sort((a,b) => { /* ... (same sorting logic as before) ... */
              const aIsValid = a.regNo && !a.regNo.startsWith('Error') && a.regNo !== 'Unknown'; const bIsValid = b.regNo && !b.regNo.startsWith('Error') && b.regNo !== 'Unknown'; if (aIsValid && !bIsValid) return -1; if (!aIsValid && bIsValid) return 1; if (!aIsValid && !bIsValid) return 0; const aNum = parseInt(a.regNo.slice(-3)); const bNum = parseInt(b.regNo.slice(-3)); if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum; return (a.regNo || "").localeCompare(b.regNo || "");
         });
     };


    // --- Search Function ---
    const executeSearch = useCallback(async (isRetry = false) => {
        // ... (Validation) ...
         const examDetails = getSelectedExamDetails();
        if (!examDetails || !regNo || !/^\d{11}$/.test(regNo)) { setError("Please select valid exam & 11-digit reg no."); setIsLoading(false); return; }


        setIsLoading(true); setLoadingStage('Fetching your result...'); setError(null); setShowLoadMore(false); setFetchedReg2(false);
        if (!isRetry) { setUserResult(null); setClassResults([]); setSearchPerformed(true); }
        else { setError(null); } // Clear errors on retry

        const year = examDetails.batchYear; const semesterRoman = getRomanSemester(examDetails.semId); const examHeld = examDetails.examHeld;
        const params = `reg_no=${regNo}&year=${year}&semester=${semesterRoman}&exam_held=${encodeURIComponent(examHeld)}`;
        setLastSearchParams(params);

        let encounteredError = false;

        try {
            // 1. Fetch User Batch FIRST
            const userBatchData = await fetchWorkerData('user', params);
            const foundUser = userBatchData.find(r => r.regNo === regNo);
            setUserResult(foundUser || { regNo: regNo, status: 'Not Found', reason: 'Not in initial response' }); // Update user state immediately
            if (foundUser?.status !== 'success') {
                 // Set error only if user wasn't found successfully
                 setError(prev => prev || `Result status for ${regNo}: ${foundUser?.status || 'Not Found'}${foundUser?.reason ? ` - ${foundUser?.reason}`: ''}`);
                 if (foundUser?.status === 'Error') encounteredError = true;
            } else {
                 setError(null); // Clear error if user found successfully
            }
            // Don't add user batch to class results yet, display separately
            setIsLoading(false); // User fetch complete

            // 2. Fetch Reg1 + LE Serially
            setLoadingStage('Loading results (1-60)...');
            const reg1Data = await fetchWorkerData('reg1', params);
            if (reg1Data.some(r => r.status === 'Error')) encounteredError = true;
            // Filter "Record not found" before adding to class results state
            setClassResults(prev => mergeAndSortResults(prev, reg1Data.filter(r => r.status !== 'Record not found')));

            setLoadingStage('Loading results (LE)...');
            const leData = await fetchWorkerData('le', params);
            if (leData.some(r => r.status === 'Error')) encounteredError = true;
            setClassResults(prev => mergeAndSortResults(prev, leData.filter(r => r.status !== 'Record not found')));

            // 3. Decide whether to show "Load More" button
            const suffixNum = parseInt(regNo.slice(-3));
            const userIsPotentiallyInReg2 = !isNaN(suffixNum) && suffixNum >= 61 && suffixNum < 900;
            const probeSuggestsBigCollege = foundUser?.status === 'success'; // Assume success means the college might be big

            // Show 'Load More' if the searched user might be in Reg2 OR if the probe succeeded (implying a potentially large college)
            if (userIsPotentiallyInReg2 || probeSuggestsBigCollege) {
                 setShowLoadMore(true);
            }

        } catch (error) { // Catch critical errors
            console.error("Critical error during search:", error); setError(`Unexpected error: ${error.message}`); encounteredError = true; setIsLoading(false);
        } finally {
            setLoadingStage(''); // Clear loading stage text
            if (encounteredError) {
                 setError(prevError => { const failMsg = "Some results failed. Try 'Retry Failed' or 'Load More'."; return prevError ? (prevError.includes(failMsg) ? prevError : `${prevError} | ${failMsg}`) : failMsg; });
            }
             // Ensure final sort after all initial fetches
             setClassResults(prev => mergeAndSortResults(prev, []));
        }
    }, [regNo, selectedExamId, getSelectedExamDetails, btechExams]);

    // --- Fetch Reg2 Results ---
    const fetchReg2Results = async () => { /* ... (Same as before - filter "Record not found") ... */
         if (!lastSearchParams) return; setIsLoadingMore(true); setLoadingStage('Loading results (61-120)...'); setError(null);
         try {
             const reg2Data = await fetchWorkerData('reg2', lastSearchParams);
             setClassResults(prev => mergeAndSortResults(prev, reg2Data.filter(r => r.status !== 'Record not found'))); // Filter here
             if (reg2Data.some(r => r.status === 'Error')) { setError("Some results (61-120) failed. Use 'Retry Failed'."); }
             setShowLoadMore(false); setFetchedReg2(true);
         } catch (error) { console.error("Critical fetch Reg2:", error); setError(`Failed load (61-120): ${error.message}`); }
         finally { setIsLoadingMore(false); setLoadingStage(''); }
    };


    // --- Event Handlers & Modal ---
    const handleSearch = (e) => { e.preventDefault(); executeSearch(false); };
    const handleRetry = () => { if (lastSearchParams) executeSearch(true); };
    const openModal = (studentResult) => { /* ... (same) ... */
        if (studentResult?.status === 'success' && studentResult.data) { setSelectedStudentData(studentResult.data); setModalOpen(true); }
        else if (studentResult){ alert(`Cannot show details for ${studentResult.regNo}: Status is ${studentResult.status}`); }
    };
    const closeModal = () => setModalOpen(false);


    // --- PDF Generation ---
    const generatePdf = () => { /* ... (generate SUMMARY Pdf - Use CLASS RESULTS state) ... */
         // Use the current classResults state, which already excludes "Record not found"
         const successfulResults = classResults.filter(res => res.status === 'success');
         // Optionally add user result if it was successful and not in the table
          if (userResult?.status === 'success' && !successfulResults.some(r => r.regNo === userResult.regNo)) {
              successfulResults.push(userResult);
          }
          successfulResults.sort((a,b) => (a.regNo || "").localeCompare(b.regNo || ""));

        if (successfulResults.length === 0) { alert("No successful results found in the class list to generate PDF."); return; }

        const doc = new jsPDF({ orientation: 'landscape' });
        const tableColumn = ["Reg No", "Name", "SGPA", "CGPA", "Result"];
        const tableRows = successfulResults.map(result => { /* ... (same row generation) ... */
             const currentSem = getArabicSemester(result.data?.semester); return [ result.regNo, result.data?.name||'N/A', result.data?.sgpa?.[currentSem - 1] ?? 'N/A', result.data?.cgpa||'N/A', result.data?.fail_any||'N/A', ]; });

        const examDetails = getSelectedExamDetails();
        doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text(`BEU Results - ${examDetails?.examName || 'Exam'}`, 14, 22);
        doc.setFont(undefined, 'normal'); doc.setFontSize(11); doc.setTextColor(100);
        doc.text(`Session: ${examDetails?.session || 'N/A'} | Exam Held: ${examDetails?.examHeld || 'N/A'}`, 14, 28); doc.setTextColor(0);

        doc.autoTable({ head: [tableColumn], body: tableRows, startY: 35, theme: 'grid', headStyles: { fillColor: [22, 160, 133], textColor: 255 }, styles: { fontSize: 8, cellPadding: 1.5 }, alternateRowStyles: { fillColor: [245, 245, 245] }, didDrawPage: (data) => { /* Footer */ doc.setFontSize(8); doc.setTextColor(100); doc.text('Generated via BeuMate App (Concept) - ' + new Date().toLocaleString(), data.settings.margin.left, doc.internal.pageSize.height - 10); } });

        // Add details page ONLY for the originally searched student IF they were successful
        const searchedStudentSuccess = successfulResults.find(r => r.regNo === regNo);
        if (searchedStudentSuccess && searchedStudentSuccess.data) {
            addStudentDetailToPdf(doc, searchedStudentSuccess.data);
        }

        doc.save(`BEU_Results_${examDetails?.semId || 'Sem'}_${examDetails?.batchYear || 'Year'}_ClassSummary.pdf`); // Changed filename slightly
    };

    const generateSinglePdf = () => { /* ... (generate DETAILED Pdf for user - same) ... */
         if (!userResult || userResult.status !== 'success' || !userResult.data) { alert('Your result was not found successfully.'); return; }
          const doc = new jsPDF({ orientation: 'portrait' }); addStudentDetailToPdf(doc, userResult.data); const examDetails = getSelectedExamDetails();
          doc.save(`BEU_Result_${userResult.regNo}_${examDetails?.semId || 'Sem'}.pdf`);
    };

     // Helper to add detailed student result page(s) to PDF
     const addStudentDetailToPdf = (doc, data) => { /* ... (Keep improved version with page breaks) ... */
          let yPos = 20; const pageHeight = doc.internal.pageSize.height; const bottomMargin = 20; const leftMargin = 14; const rightMargin = doc.internal.pageSize.width - 14;

        // --- Header ---
        doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text("BIHAR ENGINEERING UNIVERSITY, PATNA", doc.internal.pageSize.width / 2, yPos, { align: 'center' }); yPos += 6; const examDetails = getSelectedExamDetails();
        doc.setFontSize(12); doc.setFont(undefined, 'normal'); doc.text(examDetails?.examName || 'Exam Result', doc.internal.pageSize.width / 2, yPos, { align: 'center' }); yPos += 10;

        // --- Student Info ---
        doc.setFontSize(10); doc.text(`Registration No: ${data.redg_no || 'N/A'}`, leftMargin, yPos); doc.text(`Semester: ${data.semester || 'N/A'}`, rightMargin - 40, yPos); yPos += 6; doc.text(`Student Name: ${data.name || 'N/A'}`, leftMargin, yPos); yPos += 6; doc.text(`College: ${data.college_name || 'N/A'} (${data.college_code || 'N/A'})`, leftMargin, yPos); yPos += 6; doc.text(`Course: ${data.course || 'N/A'} (${data.course_code || 'N/A'})`, leftMargin, yPos); yPos += 10;

        const checkPageBreak = (currentY, requiredHeight) => { if (currentY + requiredHeight > pageHeight - bottomMargin) { doc.addPage(); return 20; } return currentY; };

        // --- Theory Subjects ---
        if (data.theorySubjects?.length > 0) { yPos = checkPageBreak(yPos, (data.theorySubjects.length + 1) * 7 + 15); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("Theory Subjects", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal'); doc.autoTable({ head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]], body: data.theorySubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']), startY: yPos, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fontSize: 8, fillColor: [220, 220, 220], textColor: 0 }, alternateRowStyles: { fillColor: [248, 248, 248] }, pageBreak: 'auto', bodyStyles: { minCellHeight: 6 } }); yPos = doc.lastAutoTable.finalY + 8; }

        // --- Practical Subjects ---
        if (data.practicalSubjects?.length > 0) { yPos = checkPageBreak(yPos, (data.practicalSubjects.length + 1) * 7 + 15); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("Practical Subjects", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal'); doc.autoTable({ head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]], body: data.practicalSubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']), startY: yPos, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fontSize: 8, fillColor: [220, 220, 220], textColor: 0 }, alternateRowStyles: { fillColor: [248, 248, 248] }, pageBreak: 'auto', bodyStyles: { minCellHeight: 6 } }); yPos = doc.lastAutoTable.finalY + 10; }

        // --- SGPA/CGPA Summary ---
        yPos = checkPageBreak(yPos, 30); doc.setFontSize(10); const currentSem = getArabicSemester(data.semester); doc.text(`SGPA (Sem ${data.semester || '?'}): ${data.sgpa?.[currentSem - 1] ?? 'N/A'}`, leftMargin, yPos); yPos += 6; doc.text(`Overall CGPA: ${data.cgpa || 'N/A'}`, leftMargin, yPos); yPos += 6; doc.setFont(undefined, 'bold'); doc.text(`Final Result Status: ${data.fail_any || 'N/A'}`, leftMargin, yPos); doc.setFont(undefined, 'normal'); yPos += 10;

        // --- SGPA History Table ---
        if (data.sgpa?.some(s => s !== null)) { yPos = checkPageBreak(yPos, 25); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("SGPA History", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal'); const sgpaCols = [["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]]; const sgpaRowPadded = [...(data.sgpa || [])]; while(sgpaRowPadded.length < 8) sgpaRowPadded.push(null); const sgpaRow = sgpaRowPadded.map(s => s ?? 'NA'); doc.autoTable({ head: sgpaCols, body: [sgpaRow], startY: yPos, theme: 'plain', styles: { fontSize: 9, cellPadding: 1, halign: 'center' }, headStyles: { fontSize: 9, fontStyle: 'bold' } }); yPos = doc.lastAutoTable.finalY + 8; }

        // --- Remarks / Fail Subjects ---
         if (data.fail_any && data.fail_any !== 'PASS') { yPos = checkPageBreak(yPos, 15); doc.setFontSize(10); doc.setTextColor(255, 0, 0); doc.setFont(undefined, 'bold'); doc.text(`Remarks: ${data.fail_any}`, leftMargin, yPos); yPos+=6; doc.setTextColor(0); doc.setFont(undefined, 'normal'); }

         // --- Publish Date ---
         if(examDetails?.publishDate){ yPos = checkPageBreak(yPos, 10); doc.setFontSize(9); doc.setTextColor(100); doc.text(`Publish Date: ${new Date(examDetails.publishDate).toLocaleDateString()}`, leftMargin, yPos); doc.setTextColor(0); yPos += 10; }

          // Footer
          doc.setFontSize(8); doc.setTextColor(100); doc.text('Generated via BeuMate App (Concept) - ' + new Date().toLocaleString(), leftMargin, pageHeight - 10);
     };

    // --- JSX ---
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>BEU Result Finder (B.Tech)</h1>

            {/* Input Form */}
            <form onSubmit={handleSearch} className={styles.form}>
                {/* Exam Dropdown */}
                 <div className={styles.formGroup}>
                     <label htmlFor="examSelect">Select Exam:</label>
                    <select id="examSelect" value={selectedExamId} onChange={(e) => setSelectedExamId(e.target.value)} required disabled={btechExams.length === 0} >
                        {btechExams.length === 0 && <option value="">Loading exams...</option>}
                        {btechExams.map(exam => ( <option key={exam.id} value={exam.id}> {exam.examName} ({exam.session}) [{exam.examHeld}] </option> ))}
                    </select>
                </div>
                {/* Reg No Input */}
                 <div className={styles.formGroup}>
                     <label htmlFor="regNoInput">Registration No:</label>
                    <input id="regNoInput" type="text" value={regNo} onChange={(e) => setRegNo(e.target.value.replace(/\D/g, ''))} required pattern="\d{11}" maxLength="11" title="Enter 11 digit Reg No" placeholder="e.g., 22104134001" />
                </div>
                {/* Buttons */}
                <div className={styles.buttonGroup}>
                    <button type="submit" disabled={isLoading || isLoadingMore || !selectedExamId || !regNo} className={`${styles.button} ${styles.buttonPrimary}`} >
                         {isLoading || isLoadingMore ? (loadingStage || 'Loading...') : 'Search Results'}
                    </button>
                    {searchPerformed && !isLoading && !isLoadingMore && (classResults.filter(r=>r.status === 'success').length > 0 || userResult?.status === 'success') && (
                        <button type="button" onClick={generatePdf} className={`${styles.button} ${styles.buttonSuccess}`} >
                            Download Class PDF
                        </button>
                    )}
                    {userResult?.status === 'success' && !isLoading && !isLoadingMore && (
                        <button type="button" onClick={generateSinglePdf} className={`${styles.button} ${styles.buttonSecondary}`}>
                            Download Your PDF
                        </button>
                    )}
                    {error && searchPerformed && !isLoading && !isLoadingMore && (
                        <button type="button" onClick={handleRetry} className={`${styles.button} ${styles.buttonWarning}`} >
                             Retry Failed
                        </button>
                    )}
                </div>
            </form>

            {/* --- Status Messages --- */}
            {(isLoading || isLoadingMore) && <div className={styles.loader}>{loadingStage || 'Loading...'}</div>}
            {error && <div className={styles.errorBox}>⚠️ {error}</div>}

            {/* --- User Result Display --- */}
            {userResult && (
                 <div className={`${styles.userResultBox} ${styles[userResult.status?.replace(/\s+/g, '')?.toLowerCase() || 'unknown']}`}>
                    <h2>Your Result Status</h2>
                    <p><strong>Reg No:</strong> {userResult.regNo}</p>
                    {userResult.status === 'success' && userResult.data ? ( /* ... User details ... */ )
                    : userResult.status === 'Record not found' ? ( <p><strong>Status:</strong> Record not found for this exam.</p> )
                    : userResult.status === 'Error' ? ( <p><strong>Status:</strong> <span className={styles.failStatus}>Error</span> - {userResult.reason || 'Failed to fetch'}</p> )
                    : null }
                     {userResult.status === 'success' && userResult.data && (
                        <>
                            <p><strong>Name:</strong> {userResult.data.name}</p>
                            <p><strong>College:</strong> {userResult.data.college_name}</p>
                             <p><strong>SGPA (Current Sem):</strong> {userResult.data.sgpa?.[getArabicSemester(userResult.data.semester) - 1] ?? 'N/A'}</p>
                             <p><strong>CGPA:</strong> {userResult.data.cgpa || 'N/A'}</p>
                             <p><strong>Status:</strong> <span className={userResult.data.fail_any?.includes('PASS') ? styles.passStatus : styles.failStatus}>{userResult.data.fail_any || 'N/A'}</span></p>
                             <button onClick={() => openModal(userResult)} className={`${styles.button} ${styles.buttonSecondary}`} style={{marginTop: '10px', padding: '8px 15px', fontSize: '0.9em'}}>View Full Details</button>
                        </>
                    )}
                </div>
            )}

             {/* --- Load More Button / Progress Info --- */}
             {searchPerformed && !isLoading && showLoadMore && !isLoadingMore && !fetchedReg2 && (
                 <div className={styles.loadMoreContainer}>
                    <p>Showing results for 1-60 & LE students. Click to load remaining.</p>
                    <button onClick={fetchReg2Results} className={`${styles.button} ${styles.buttonSecondary}`}>
                        Load More Results (61-120)
                    </button>
                 </div>
             )}
             {/* {isLoadingMore && <div className={styles.loader}>{loadingStage}</div>} */} {/* Loader shown globally now */}
             {searchPerformed && !isLoading && !showLoadMore && fetchedReg2 && <div className={styles.progressInfo}>All available results (1-120 & LE) loaded.</div>}


            {/* --- Class Results Table --- */}
             {searchPerformed && classResults.length > 0 && <h2 className={styles.tableTitle}>{loadingStage ? loadingStage : 'Class Results (Excluding "Not Found")'}</h2>}
            {searchPerformed && classResults.length > 0 && (
                <div className={styles.tableContainer}>
                    <table className={styles.resultsTable}>
                        <thead>
                            <tr>
                                <th>Reg No</th> <th>Name</th> <th>SGPA</th> <th>CGPA</th> <th>Status</th> <th>Details / Reason</th>
                            </tr>
                        </thead>
                        <tbody>
                            {classResults
                               .filter(result => result.regNo !== userResult?.regNo) // Filter out user row if shown above
                               .map((result, index) => (
                                <tr key={result.regNo || `error-${index}`}
                                    className={`${result.status === 'Error' ? styles.errorRow : ''}`}
                                    onClick={() => openModal(result)}
                                    style={{cursor: result.status === 'success' ? 'pointer' : 'default'}} >
                                    <td>{result.regNo}</td>
                                    <td>{result.data?.name || '---'}</td>
                                    <td>{result.data?.sgpa?.[getArabicSemester(result.data?.semester || 'I') - 1] ?? '---'}</td>
                                    <td>{result.data?.cgpa || '---'}</td>
                                    <td className={result.data?.fail_any && !result.data.fail_any.includes('PASS') ? styles.failStatus : (result.status === 'Error' ? styles.failStatus : '')}>
                                        {result.status === 'success' ? (result.data?.fail_any || 'N/A') : result.status}
                                     </td>
                                    <td className={styles.reasonCell}>{result.status === 'Error' ? result.reason : (result.status === 'success' ? 'Click row for details' : '---')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {/* No results message */}
            {searchPerformed && !isLoading && !userResult && classResults.length === 0 && !error && <p className={styles.noResults}>No results found or loaded yet for the class.</p>}

             {/* --- Modal for Full Details --- */}
             {modalOpen && selectedStudentData && (
                <div className={styles.modalBackdrop} onClick={closeModal}>
                    <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                         <button className={styles.modalCloseButton} onClick={closeModal}>&times;</button>
                        <h2>Detailed Result</h2>
                        <div className={styles.modalScrollable}>
                            {/* Student Info */}
                            <p><strong>Reg No:</strong> {selectedStudentData.redg_no}</p>
                            <p><strong>Name:</strong> {selectedStudentData.name}</p>
                            {/* ... other info ... */}
                             <p><strong>College:</strong> {selectedStudentData.college_name} ({selectedStudentData.college_code})</p>
                            <p><strong>Course:</strong> {selectedStudentData.course} ({selectedStudentData.course_code})</p>
                            <p><strong>Semester:</strong> {selectedStudentData.semester}</p>

                            {/* Theory Table */}
                            <hr/><h3 style={{marginTop: '15px'}}>Theory Subjects</h3>
                             {selectedStudentData.theorySubjects?.length > 0 ? (
                                <table className={styles.modalTable}><thead><tr><th>Code</th><th>Name</th><th>ESE</th><th>IA</th><th>Total</th><th>Grade</th><th>Credit</th></tr></thead><tbody>
                                {selectedStudentData.theorySubjects.map(s => <tr key={s.code}><td>{s.code}</td><td>{s.name}</td><td>{s.ese??'-'}</td><td>{s.ia??'-'}</td><td>{s.total??'-'}</td><td>{s.grade??'-'}</td><td>{s.credit??'-'}</td></tr>)}</tbody></table>
                             ) : <p>No theory subjects found.</p>}

                            {/* Practical Table */}
                             <hr/><h3 style={{marginTop: '15px'}}>Practical Subjects</h3>
                             {selectedStudentData.practicalSubjects?.length > 0 ? (
                                <table className={styles.modalTable}><thead><tr><th>Code</th><th>Name</th><th>ESE</th><th>IA</th><th>Total</th><th>Grade</th><th>Credit</th></tr></thead><tbody>
                                {selectedStudentData.practicalSubjects.map(s => <tr key={s.code}><td>{s.code}</td><td>{s.name}</td><td>{s.ese??'-'}</td><td>{s.ia??'-'}</td><td>{s.total??'-'}</td><td>{s.grade??'-'}</td><td>{s.credit??'-'}</td></tr>)}</tbody></table>
                              ): <p>No practical subjects found.</p>}

                             {/* Summary */}
                              <hr/><div style={{marginTop: '15px'}}>
                              <p><strong>SGPA (Current Sem):</strong> {selectedStudentData.sgpa?.[getArabicSemester(selectedStudentData.semester) - 1] ?? 'N/A'}</p>
                              <p><strong>CGPA:</strong> {selectedStudentData.cgpa || 'N/A'}</p>
                              <p><strong>Status:</strong> <span className={selectedStudentData.fail_any?.includes('PASS') ? styles.passStatus : styles.failStatus}>{selectedStudentData.fail_any || 'N/A'}</span></p>
                              </div>

                               {/* SGPA History */}
                               {selectedStudentData.sgpa?.some(s => s !== null) && ( <> <hr/><h3 style={{marginTop: '15px'}}>SGPA History</h3> <table className={styles.modalTable}><thead><tr><th>I</th><th>II</th><th>III</th><th>IV</th><th>V</th><th>VI</th><th>VII</th><th>VIII</th></tr></thead><tbody><tr>{Array.from({ length: 8 }).map((_, i) => <td key={i}>{selectedStudentData.sgpa[i] ?? 'NA'}</td>)}</tr></tbody></table></> )}
                               {/* Remarks */}
                                {selectedStudentData.fail_any && selectedStudentData.fail_any !== 'PASS' && ( <> <hr/> <p style={{marginTop: '15px'}}><strong>Remarks:</strong> <span className={styles.failStatus}>{selectedStudentData.fail_any}</span></p></> )}
                        </div> {/* End Scrollable */}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultFinder;
