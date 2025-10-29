// components/ResultFinder.js
import React, { useState, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';

// --- Configuration: Your Final Cloudflare Worker URLs ---
// IMPORTANT: Replace with your actual deployed worker URLs
const WORKER_URLS = {
    user: "https://resulta-user.walla.workers.dev/api/result", // Replace beunotes.workers.dev if needed
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
                // Try to extract a more specific error if available
                errorReason = errorJson.error || (Array.isArray(errorJson) && errorJson[0]?.reason) || errorReason; // Try to get reason from array too
            } catch (e) { /* Ignore parsing error */ }
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
        // Return error structure consistent with expected format
         const baseRegNo = params.split('&')[0].split('=')[1] || 'Unknown';
         // Attempt to guess batch size needed for error array
         const batchSize = 5; // Assuming batch size is always 5
         const baseNum = parseInt(baseRegNo.slice(-3)) || 0;
         const batchRegNos = Array.from({ length: batchSize }, (_, i) => `${baseRegNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
         // Return error objects for the guessed batch range
         return batchRegNos.map(rn => ({ regNo: rn, status: 'Error', reason: error.message }));
    }
}


// --- Main Component ---
const ResultFinder = () => {
    // --- State Variables ---
    const [btechExams, setBtechExams] = useState([]);
    const [selectedExamId, setSelectedExamId] = useState('');
    const [regNo, setRegNo] = useState('');

    const [allResults, setAllResults] = useState([]); // Holds combined results for display
    const [userResult, setUserResult] = useState(null); // Holds the specific user's result object {regNo, status, data?, reason?}
    const [isLoading, setIsLoading] = useState(false); // Overall loading state
    const [loadingStage, setLoadingStage] = useState(''); // More granular loading message
    const [error, setError] = useState(null);
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [lastSearchParams, setLastSearchParams] = useState(null); // For retry

    // --- Fetch Exam List ---
    useEffect(() => {
        const fetchExams = async () => {
            setError(null); // Clear previous errors
            console.log("Fetching exam list...");
            try {
                const response = await fetch(BEU_EXAM_LIST_URL);
                 if (!response.ok) { throw new Error(`BEU API Error: ${response.status}`); }
                const data = await response.json();
                const btechCourse = data.find(course => course.courseName === "B.Tech");
                if (btechCourse && btechCourse.exams) {
                    const sortedExams = [...btechCourse.exams].sort((a, b) => {
                         if(a.semId !== b.semId) return b.semId - a.semId; // Higher semester first
                         return a.examName.localeCompare(b.examName);
                    });
                    setBtechExams(sortedExams);
                    if (sortedExams.length > 0) {
                        setSelectedExamId(sortedExams[0].id.toString());
                        console.log("Exam list loaded.");
                    } else {
                         console.warn("No B.Tech exams found in API response.");
                         setError("No B.Tech exams found.");
                    }
                } else {
                     console.warn("B.Tech course or exams not found in API response.");
                     setError("B.Tech exams not found in BEU API response.");
                }
            } catch (err) {
                console.error("Failed to fetch exam list:", err);
                setError(`Could not load exam list: ${err.message}`);
            }
        };
        fetchExams();
    }, []);

    // --- Get Selected Exam Details ---
    const getSelectedExamDetails = useCallback(() => {
        return btechExams.find(exam => exam.id.toString() === selectedExamId);
    }, [btechExams, selectedExamId]);

    // --- Search Function (Handles Initial Search & Retry) ---
    const executeSearch = useCallback(async (isRetry = false) => {
        const examDetails = getSelectedExamDetails();
        if (!examDetails || !regNo || !/^\d{11}$/.test(regNo)) {
            setError("Please select a valid exam and enter a valid 11-digit registration number.");
            setIsLoading(false); // Stop loading if validation fails
            return;
        }

        setIsLoading(true);
        setLoadingStage('Fetching your result...');
        setError(null);
        if (!isRetry) {
            setUserResult(null);
            setAllResults([]);
            setSearchPerformed(true);
        } else {
             setError(null); // Clear previous errors on retry
        }

        const year = examDetails.batchYear;
        const semesterRoman = getRomanSemester(examDetails.semId);
        const examHeld = examDetails.examHeld;
        const params = `reg_no=${regNo}&year=${year}&semester=${semesterRoman}&exam_held=${encodeURIComponent(examHeld)}`;
        setLastSearchParams(params);

        // This will hold results as they come in
        let combinedResults = [];
        let encounteredError = false;
        let foundUserResult = null;

        try {
            // 1. Fetch User Batch FIRST
            const userBatchData = await fetchWorkerData('user', params);
            combinedResults = [...userBatchData]; // Start with the user's batch
            foundUserResult = userBatchData.find(r => r.regNo === regNo);

            // Display user result status immediately
            if (foundUserResult) {
                setUserResult(foundUserResult); // Store the specific user result object
                if (foundUserResult.status !== 'success') {
                     // Set error, but don't overwrite if a more critical fetch error happens later
                     setError(prev => prev || `Result status for ${regNo}: ${foundUserResult.status}${foundUserResult.reason ? ` - ${foundUserResult.reason}`: ''}`);
                }
            } else {
                 const batchError = userBatchData.find(r => r.status === 'Error');
                 const errorMsg = batchError ? `Error fetching your batch: ${batchError.reason}` : `Result for ${regNo} not found in initial fetch (may load later).`;
                 setError(prev => prev || errorMsg);
                 // Try to show the error specific to the user's regNo if the batch itself had errors
                 foundUserResult = batchError || { regNo: regNo, status: 'Not Found in Batch', reason: 'Not present in initial response' };
                 setUserResult(foundUserResult);
            }
            // Update display state with initial batch results
            setAllResults(prev => mergeAndSortResults(prev, userBatchData));
            setIsLoading(false); // Initial user fetch done


            // 2. Fetch others serially
            const otherWorkers = ['reg1', 'reg2', 'le'];
            for (const workerKey of otherWorkers) {
                setLoadingStage(`Loading ${workerKey} results...`);
                const data = await fetchWorkerData(workerKey, params);
                // Update display state incrementally after each worker finishes
                 setAllResults(prev => mergeAndSortResults(prev, data));
                if (data.some(r => r.status === 'Error')) {
                    encounteredError = true;
                }
            }

        } catch (error) {
            // Catch critical errors from fetchWorkerData itself (should be rare)
            console.error("Critical error during search execution:", error);
            setError(`An unexpected error occurred: ${error.message}`);
            encounteredError = true;
        } finally {
            setIsLoading(false); // Ensure loading is off
            setLoadingStage(''); // Clear loading stage message
            if (encounteredError) {
                 // Set or append the error message about failed loads
                 setError(prevError => {
                     const failMsg = "Some class results failed to load. You can use 'Retry Failed' if needed.";
                     // Avoid duplicating the message
                     return prevError ? (prevError.includes(failMsg) ? prevError : `${prevError} | ${failMsg}`) : failMsg;
                 });
            }
             // Final cleanup: Ensure uniqueness and sort one last time (important after all fetches)
             setAllResults(prev => mergeAndSortResults(prev, []));
        }
    }, [regNo, selectedExamId, getSelectedExamDetails, btechExams]); // Added btechExams dependency

     // --- Merge, Unique, Sort Helper ---
     const mergeAndSortResults = (existingResults, newResults) => {
         // Create a map from existing results
         const resultMap = new Map(existingResults.map(item => [item.regNo || `error-${Math.random()}`, item]));
         // Add or update entries with new results
         newResults.forEach(item => {
             // Prioritize non-error status if merging duplicates
             const existing = resultMap.get(item.regNo);
             if (!existing || (existing.status === 'Error' && item.status !== 'Error') || !item.regNo) {
                 resultMap.set(item.regNo || `error-${Math.random()}`, item);
             }
         });
         // Convert back to array and sort
         return Array.from(resultMap.values()).sort((a,b) => {
            // Ensure consistent sorting: valid reg numbers first, then errors
            const aIsValid = a.regNo && !a.regNo.startsWith('Error') && a.regNo !== 'Unknown';
            const bIsValid = b.regNo && !b.regNo.startsWith('Error') && b.regNo !== 'Unknown';
            if (aIsValid && !bIsValid) return -1;
            if (!aIsValid && bIsValid) return 1;
            if (!aIsValid && !bIsValid) return 0; // Keep relative order of errors/unknowns
            // Sort valid numbers numerically if possible, otherwise string compare
            const aNum = parseInt(a.regNo.slice(-3));
            const bNum = parseInt(b.regNo.slice(-3));
            if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
            return (a.regNo || "").localeCompare(b.regNo || "");
         });
     };

    // --- Event Handlers ---
    const handleSearch = (e) => { e.preventDefault(); executeSearch(false); };
    const handleRetry = () => { if (lastSearchParams) executeSearch(true); };

    // --- PDF Generation ---
    const generatePdf = () => {
        if (allResults.length === 0) return;
        const successfulResults = allResults.filter(res => res.status === 'success');
        if (successfulResults.length === 0) {
            alert("No successful results to generate PDF for.");
            return;
        }

        const doc = new jsPDF({ orientation: 'landscape' }); // Use landscape for wide summary table
        const tableColumn = ["Reg No", "Name", "SGPA", "CGPA", "Result"];
        const tableRows = successfulResults.map(result => {
             const currentSem = getArabicSemester(result.data?.semester);
             return [
                 result.regNo,
                 result.data?.name || 'N/A',
                 result.data?.sgpa?.[currentSem - 1] ?? 'N/A',
                 result.data?.cgpa || 'N/A',
                 result.data?.fail_any || 'N/A',
             ];
        });

        const examDetails = getSelectedExamDetails();
        doc.setFontSize(16);
        doc.text(`BEU Results - ${examDetails?.examName || 'Exam'}`, 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
         doc.text(`Session: ${examDetails?.session || 'N/A'} | Exam Held: ${examDetails?.examHeld || 'N/A'}`, 14, 28)

        doc.autoTable({
            head: [tableColumn], body: tableRows, startY: 35, theme: 'grid',
            headStyles: { fillColor: [22, 160, 133], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 1.5 },
             alternateRowStyles: { fillColor: [245, 245, 245] },
             didDrawPage: (data) => { /* Footer */ doc.setFontSize(8); doc.setTextColor(100); doc.text('Generated via BeuMate App (Concept) - ' + new Date().toLocaleString(), data.settings.margin.left, doc.internal.pageSize.height - 10); }
        });

        // Add details page only for the searched student if successful
         const searchedStudentResult = successfulResults.find(r => r.regNo === regNo);
        if (searchedStudentResult && searchedStudentResult.data) {
            addStudentDetailToPdf(doc, searchedStudentResult.data); // Add as new page(s)
        }

        doc.save(`BEU_Results_${examDetails?.semId || 'Sem'}_${examDetails?.batchYear || 'Year'}_Summary.pdf`);
    };

     // Helper to add detailed student result page(s) to PDF
     const addStudentDetailToPdf = (doc, data) => {
        doc.addPage({ orientation: 'portrait' }); // Portrait for details page
        let yPos = 20; // Start near top
        const pageHeight = doc.internal.pageSize.height;
        const bottomMargin = 20;
        const leftMargin = 14;
        const rightMargin = doc.internal.pageSize.width - 14;

        // --- Header ---
        doc.setFontSize(14); doc.setFont(undefined, 'bold');
        doc.text("BIHAR ENGINEERING UNIVERSITY, PATNA", doc.internal.pageSize.width / 2, yPos, { align: 'center' });
        yPos += 6;
        const examDetails = getSelectedExamDetails();
        doc.setFontSize(12); doc.setFont(undefined, 'normal');
        doc.text(examDetails?.examName || 'Exam Result', doc.internal.pageSize.width / 2, yPos, { align: 'center' });
        yPos += 10;

        // --- Student Info ---
        doc.setFontSize(10);
        doc.text(`Registration No: ${data.redg_no || 'N/A'}`, leftMargin, yPos);
        doc.text(`Semester: ${data.semester || 'N/A'}`, rightMargin - 40, yPos); // Align right
        yPos += 6;
        doc.text(`Student Name: ${data.name || 'N/A'}`, leftMargin, yPos);
        yPos += 6;
        doc.text(`College: ${data.college_name || 'N/A'} (${data.college_code || 'N/A'})`, leftMargin, yPos);
        yPos += 6;
        doc.text(`Course: ${data.course || 'N/A'} (${data.course_code || 'N/A'})`, leftMargin, yPos);
        yPos += 10;

        // Function to check if page break needed before table/section
        const checkPageBreak = (currentY, requiredHeight) => {
            if (currentY + requiredHeight > pageHeight - bottomMargin) {
                doc.addPage();
                return 20; // New Y position
            }
            return currentY;
        };

        // --- Theory Subjects ---
        if (data.theorySubjects && data.theorySubjects.length > 0) {
            yPos = checkPageBreak(yPos, (data.theorySubjects.length + 1) * 7 + 15); // Estimate height
            doc.setFontSize(11); doc.setFont(undefined, 'bold');
            doc.text("Theory Subjects", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal');
            doc.autoTable({
                head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]],
                body: data.theorySubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']),
                startY: yPos, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fontSize: 8, fillColor: [220, 220, 220], textColor: 0 }, alternateRowStyles: { fillColor: [248, 248, 248] },
                 pageBreak: 'auto', bodyStyles: { minCellHeight: 6 }
            });
            yPos = doc.lastAutoTable.finalY + 8;
        }

        // --- Practical Subjects ---
        if (data.practicalSubjects && data.practicalSubjects.length > 0) {
            yPos = checkPageBreak(yPos, (data.practicalSubjects.length + 1) * 7 + 15);
            doc.setFontSize(11); doc.setFont(undefined, 'bold');
            doc.text("Practical Subjects", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal');
            doc.autoTable({
                head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]],
                body: data.practicalSubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']),
                startY: yPos, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fontSize: 8, fillColor: [220, 220, 220], textColor: 0 }, alternateRowStyles: { fillColor: [248, 248, 248] },
                 pageBreak: 'auto', bodyStyles: { minCellHeight: 6 }
            });
            yPos = doc.lastAutoTable.finalY + 10;
        }

        // --- SGPA/CGPA Summary ---
        yPos = checkPageBreak(yPos, 30);
        doc.setFontSize(10);
        const currentSem = getArabicSemester(data.semester);
        doc.text(`SGPA (Sem ${data.semester || '?'}): ${data.sgpa?.[currentSem - 1] ?? 'N/A'}`, leftMargin, yPos);
        yPos += 6;
        doc.text(`Overall CGPA: ${data.cgpa || 'N/A'}`, leftMargin, yPos);
        yPos += 6;
         doc.setFont(undefined, 'bold');
        doc.text(`Final Result Status: ${data.fail_any || 'N/A'}`, leftMargin, yPos);
         doc.setFont(undefined, 'normal');
        yPos += 10;

        // --- SGPA History Table ---
        if (data.sgpa && data.sgpa.some(s => s !== null)) {
             yPos = checkPageBreak(yPos, 25);
             doc.setFontSize(11); doc.setFont(undefined, 'bold');
             doc.text("SGPA History", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal');
             const sgpaCols = [["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]]; // Use Roman numerals for header
             const sgpaRowPadded = [...(data.sgpa || [])];
             while(sgpaRowPadded.length < 8) sgpaRowPadded.push(null);
             const sgpaRow = sgpaRowPadded.map(s => s ?? 'NA');

             doc.autoTable({ head: sgpaCols, body: [sgpaRow], startY: yPos, theme: 'plain', styles: { fontSize: 9, cellPadding: 1, halign: 'center' }, headStyles: { fontSize: 9, fontStyle: 'bold' } });
             yPos = doc.lastAutoTable.finalY + 8;
        }

        // --- Remarks / Fail Subjects ---
         if (data.fail_any && data.fail_any !== 'PASS') {
              yPos = checkPageBreak(yPos, 15);
             doc.setFontSize(10);
             doc.setTextColor(255, 0, 0); // Red
             doc.setFont(undefined, 'bold');
             doc.text(`Remarks: ${data.fail_any}`, leftMargin, yPos);
             // Logic to extract subject codes/names from fail_any string if possible
             // Example: if (data.fail_any.startsWith("FAIL:")) { ... }
             yPos+=6;
             doc.setTextColor(0); // Reset color
              doc.setFont(undefined, 'normal');
         }

         // --- Publish Date ---
         if(examDetails?.publishDate){
             yPos = checkPageBreak(yPos, 10);
            doc.setFontSize(9);
            doc.setTextColor(100);
            doc.text(`Publish Date: ${new Date(examDetails.publishDate).toLocaleDateString()}`, leftMargin, yPos);
            doc.setTextColor(0);
         }
    };


    // --- JSX ---
    return (
        <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '1400px', margin:'0 auto' }}>
            <h1 style={{ textAlign: 'center', marginBottom: '25px', color: '#333' }}>BEU Result Finder (B.Tech)</h1>

            {/* Input Form */}
            <form onSubmit={handleSearch} style={{ marginBottom: '30px', padding: '20px', border: '1px solid #ddd', borderRadius: '8px', backgroundColor: '#f9f9f9', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                {/* Exam Dropdown */}
                 <div style={{ marginBottom: '15px' }}>
                    <label htmlFor="examSelect" style={{ marginRight: '10px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Select Exam:</label>
                    <select
                        id="examSelect"
                        value={selectedExamId}
                        onChange={(e) => setSelectedExamId(e.target.value)}
                        required
                        style={{ padding: '10px', width: '100%', borderRadius: '4px', border: '1px solid #ccc', fontSize:'1em' }}
                        disabled={btechExams.length === 0}
                    >
                        {btechExams.length === 0 && <option value="">Loading exams...</option>}
                        {btechExams.map(exam => (
                            <option key={exam.id} value={exam.id}>
                                {exam.examName} ({exam.session}) [{exam.examHeld}]
                            </option>
                        ))}
                    </select>
                </div>
                {/* Reg No Input */}
                 <div style={{ marginBottom: '15px' }}>
                    <label htmlFor="regNoInput" style={{ marginRight: '10px', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>Registration No:</label>
                    <input
                        id="regNoInput"
                        type="text"
                        value={regNo}
                        onChange={(e) => setRegNo(e.target.value.replace(/\D/g, ''))} // Allow only digits
                        required
                        pattern="\d{11}"
                        maxLength="11"
                        title="Enter 11 digit Registration Number"
                        placeholder="e.g., 22104134001"
                        style={{ padding: '10px', width: '100%', borderRadius: '4px', border: '1px solid #ccc', fontSize:'1em' }}
                    />
                </div>
                {/* Buttons */}
                <div style={{display: 'flex', gap: '10px', flexWrap: 'wrap'}}>
                    <button type="submit" disabled={isLoading || !selectedExamId || !regNo} /* style... */ >
                         {isLoading ? 'Searching...' : (loadingStage || 'Search Results')}
                    </button>
                    {searchPerformed && !isLoading && (
                        <button type="button" onClick={generatePdf} disabled={allResults.filter(r=>r.status === 'success').length === 0} /* style... */ >
                            Download PDF
                        </button>
                    )}
                    {error && searchPerformed && !isLoading && (
                        <button type="button" onClick={handleRetry} /* style... */ >
                             Retry Failed
                        </button>
                    )}
                </div>
                 {/* Apply styles directly for brevity or use CSS classes */}
                 <style jsx>{`
                    button {
                        padding: 10px 20px; cursor: pointer; border: none;
                        border-radius: 4px; font-size: 1em; transition: background-color 0.2s ease;
                        margin-right: 10px; margin-bottom: 10px;
                    }
                    button:disabled { cursor: not-allowed; opacity: 0.6; }
                    button[type="submit"] { background-color: #007bff; color: white; }
                    button[type="submit"]:hover:not(:disabled) { background-color: #0056b3; }
                    button:nth-of-type(2) { background-color: #28a745; color: white; }
                    button:nth-of-type(2):hover:not(:disabled) { background-color: #1e7e34; }
                    button:nth-of-type(3) { background-color: #ffc107; color: black; }
                    button:nth-of-type(3):hover:not(:disabled) { background-color: #e0a800; }
                `}</style>
            </form>

            {/* --- Status Messages --- */}
            {isLoading && <p style={{ textAlign: 'center', fontWeight: 'bold' }}>{loadingStage || 'Loading...'}</p>}
            {error && <p style={{ color: '#721c24', fontWeight: 'bold', textAlign: 'center', marginTop: '15px', padding: '10px', backgroundColor: '#f8d7da', borderRadius: '4px', border: '1px solid #f5c6cb' }}>⚠️ {error}</p>}

            {/* --- User Result Display --- */}
            {userResult && (
                <div style={{
                     border: `1px solid ${userResult.status === 'success' ? '#198754' : (userResult.status === 'Record not found' ? '#6c757d' : '#dc3545')}`,
                     margin: '25px 0', padding: '15px 20px',
                     backgroundColor: userResult.status === 'success' ? '#d1e7dd' : (userResult.status === 'Record not found' ? '#e9ecef' : '#f8d7da'),
                     borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
                 }}>
                    <h2 style={{marginTop: 0, marginBottom: '15px', paddingBottom: '10px', borderBottom: '1px solid rgba(0,0,0,0.1)', fontSize: '1.4em'}}>Your Result Status</h2>
                    <p><strong>Reg No:</strong> {userResult.regNo}</p>
                    {userResult.status === 'success' && userResult.data ? (
                        <>
                            <p><strong>Name:</strong> {userResult.data.name}</p>
                            <p><strong>College:</strong> {userResult.data.college_name}</p>
                             <p><strong>SGPA (Current Sem):</strong> {userResult.data.sgpa?.[getArabicSemester(userResult.data.semester) - 1] ?? 'N/A'}</p>
                             <p><strong>CGPA:</strong> {userResult.data.cgpa || 'N/A'}</p>
                             <p><strong>Status:</strong> <span style={{fontWeight:'bold', color: userResult.data.fail_any?.includes('PASS') ? '#198754' : '#dc3545'}}>{userResult.data.fail_any || 'N/A'}</span></p>
                        </>
                    ) : userResult.status === 'Record not found' ? (
                         <p><strong>Status:</strong> Record not found for this exam.</p>
                    ) : userResult.status === 'Error' ? (
                          <p><strong>Status:</strong> <span style={{color: '#dc3545', fontWeight: 'bold'}}>Error</span> - {userResult.reason || 'Failed to fetch'}</p>
                    ) : null }
                </div>
            )}

            {/* --- Class Results Table --- */}
             {searchPerformed && allResults.length > 0 && <h2 style={{ marginTop: '30px', borderBottom: '2px solid #007bff', paddingBottom: '5px' }}>{loadingStage ? loadingStage : 'Class Results'}</h2>}
            {searchPerformed && allResults.length > 0 && (
                <div style={{ overflowX: 'auto', marginTop: '15px', border: '1px solid #dee2e6', borderRadius: '5px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9em' }}>
                    <thead style={{ backgroundColor: '#e9ecef' }}>
                        <tr>
                            <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6', textAlign: 'left' }}>Reg No</th>
                            <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6', textAlign: 'left' }}>Name</th>
                            <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>SGPA</th>
                            <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>CGPA</th>
                            <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6' }}>Status</th>
                            <th style={{ padding: '10px', borderBottom: '2px solid #dee2e6', textAlign: 'left', minWidth: '150px' }}>Details / Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        {allResults.map((result, index) => (
                            <tr key={result.regNo || `error-${index}`} style={{ backgroundColor: result.regNo === regNo ? '#cfe2ff' : (result.status === 'Error' ? '#f8d7da' : 'inherit' ), borderTop: '1px solid #dee2e6' }}>
                                <td style={{ padding: '8px 10px' }}>{result.regNo}</td>
                                <td style={{ padding: '8px 10px' }}>{result.data?.name || '---'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>{result.data?.sgpa?.[getArabicSemester(result.data?.semester || 'I') - 1] ?? '---'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center' }}>{result.data?.cgpa || '---'}</td>
                                <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: (result.data?.fail_any && !result.data.fail_any.includes('PASS')) ? 'bold' : 'normal', color: (result.data?.fail_any && !result.data.fail_any.includes('PASS')) ? '#dc3545' : (result.status === 'Error' ? '#dc3545' : 'inherit') }}>
                                    {result.status === 'success' ? (result.data?.fail_any || 'N/A') : result.status}
                                 </td>
                                <td style={{ padding: '8px 10px', color: '#dc3545', fontSize: '0.85em' }}>{result.status === 'Error' ? result.reason : '---'}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                </div>
            )}
            {/* Loading indicator at the bottom */}
            {loadingStage && <p style={{ textAlign: 'center', margin: '20px', fontStyle: 'italic', color: '#6c757d' }}>{loadingStage}</p>}
            {/* No results message */}
            {searchPerformed && !isLoading && allResults.length === 0 && !error && <p style={{ textAlign: 'center', marginTop: '20px' }}>No results found.</p>}
        </div>
    );
};

export default ResultFinder;
