// components/ResultFinder.js
import React, { useState, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import styles from '../styles/ResultFinder.module.css';

// --- Configuration: Your Final Cloudflare Worker URLs ---
const WORKER_URLS = {
    user: "https://resulta-user.walla.workers.dev/api/result", // REPLACE
    reg1: "https://resulta-reg1.walla.workers.dev/api/result", // REPLACE
    reg2: "https://resulta-reg2.walla.workers.dev/api/result", // REPLACE
    le:   "https://resulta-le.walla.workers.dev/api/result",   // REPLACE
};
// This is your exam list proxy. We MUST use it here for the cache.
const BEU_EXAM_LIST_URL = 'https://resulta-exams-proxy.walla.workers.dev'; // REPLACE
const LAZY_LOAD_DELAY = 40; 
const BATCH_STEP = 5;
// --- IMPORTANT: Set your website name for the PDF footer ---
const MY_WEBSITE_NAME = "[YourWebsiteName.com]"; // <-- *** CHANGE THIS ***

// --- Helper Maps ---
const arabicToRomanMap = { 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI', 7: 'VII', 8: 'VIII' };
const romanToArabicMap = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8 };
const getRomanSemester = (semId) => arabicToRomanMap[semId] || '';
const getArabicSemester = (roman) => roman ? romanToArabicMap[roman.toUpperCase()] || 0 : 0;

// --- Fetch Worker Data Helper ---
async function fetchWorkerData(workerKey, params) {
    const url = `${WORKER_URLS[workerKey]}?${params}`;
    console.log(`Fetching from ${workerKey}...`);
    try {
        const response = await fetch(url);
        if (!response.ok) {
            let errorReason = `Worker ${workerKey} request failed: ${response.status}`;
            try { const errorJson = await response.json(); errorReason = errorJson.error || (Array.isArray(errorJson) && errorJson[0]?.reason) || errorReason; } catch (e) { /* Ignore */ }
            throw new Error(errorReason);
        }
        const data = await response.json();
        if (!Array.isArray(data)) { throw new Error(`Worker ${workerKey} invalid data format.`); }
        console.log(`Received ${data.length} results from ${workerKey}`);
        return data;
    } catch (error) {
        console.error(`Error fetching from ${workerKey} (${url}):`, error);
         const baseRegNo = params.split('&')[0].split('=')[1] || 'Unknown';
         const baseNum = parseInt(baseRegNo.slice(-3)) || 0;
         const batchRegNos = Array.from({ length: BATCH_STEP }, (_, i) => `${baseRegNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
         return batchRegNos.map(rn => ({ regNo: rn, status: 'Error', reason: error.message }));
    }
}


// --- Main Component ---
const ResultFinder = ({ selectedExamIdProp }) => {
    // --- State ---
    const [selectedExamDetails, setSelectedExamDetails] = useState(null);
    const [regNo, setRegNo] = useState('');
    const [userResult, setUserResult] = useState(null);
    const [classResults, setClassResults] = useState([]);
    const [fetchedDataQueue, setFetchedDataQueue] = useState([]);
    const [errorList, setErrorList] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingStage, setLoadingStage] = useState('');
    const [progress, setProgress] = useState({ percent: 0, loaded: 0, total: 0, stage: '' });
    const [error, setError] = useState(null);
    const [searchPerformed, setSearchPerformed] = useState(false);
    const [lastSearchParams, setLastSearchParams] = useState(null);
    const [showLoadMore, setShowLoadMore] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [fetchedReg2, setFetchedReg2] = useState(false);
    // --- DELETED modalOpen and selectedStudentData states ---

    // --- Fetch Exam Details ---
    useEffect(() => {
        if (!selectedExamIdProp) return;
        const fetchExamDetails = async () => {
            console.log(`Fetching details for examId: ${selectedExamIdProp}`);
            setError(null); 
            try {
                // This calls your proxy, which is now in sync
                const response = await fetch(BEU_EXAM_LIST_URL); 
                if (!response.ok) {
                    const errData = await response.json();
                    throw new Error(errData.details || `BEU API Proxy Error: ${response.status}`);
                }
                const data = await response.json();
                let foundExam = null;
                for (const course of data) {
                    if (course.exams) {
                        foundExam = course.exams.find(ex => ex.id.toString() === selectedExamIdProp);
                        if (foundExam) break;
                    }
                }
                if (foundExam) {
                    setSelectedExamDetails(foundExam);
                    console.log("Exam details set:", foundExam);
                } else { setError(`Exam details for ID ${selectedExamIdProp} not found.`); }
            } catch (err) { console.error("Failed to fetch exam details:", err); setError(`Could not load exam details: ${err.message}`); }
        };
        fetchExamDetails();
    }, [selectedExamIdProp]);

    // --- Get Selected Exam Details (Helper) ---
    const getSelectedExamDetails = useCallback(() => {
        return selectedExamDetails;
    }, [selectedExamDetails]);

    // --- Merge, Unique, Sort Helper (Filters "Record not found") ---
     const mergeAndSortResults = (existingResults, newResults) => {
         const resultMap = new Map(existingResults.map(item => [item.regNo || `error-${Math.random()}`, item]));
         newResults.forEach(item => {
             if (item.status !== 'Record not found') {
                 const existing = resultMap.get(item.regNo);
                 if (!existing || (existing.status === 'Error' && item.status !== 'Error') || !item.regNo) {
                    resultMap.set(item.regNo || `error-${Math.random()}`, item);
                 }
             } else {
                 if (resultMap.has(item.regNo)) { resultMap.delete(item.regNo); }
             }
         });
         return Array.from(resultMap.values()).sort((a,b) => {
              const aIsValid = a.regNo && !a.regNo.startsWith('Error') && a.regNo !== 'Unknown';
              const bIsValid = b.regNo && !b.regNo.startsWith('Error') && b.regNo !== 'Unknown';
              if (aIsValid && !bIsValid) return -1;
              if (!aIsValid && bIsValid) return 1;
              if (!aIsValid && !bIsValid) return 0;
              const aNum = parseInt(a.regNo.slice(-3));
              const bNum = parseInt(b.regNo.slice(-3));
              if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
              return (a.regNo || "").localeCompare(b.regNo || "");
         });
     };
     
    // --- One-by-one Lazy Load Effect ---
    useEffect(() => {
        if (fetchedDataQueue.length === 0) {
             if(isLoading || isLoadingMore) {
                 setProgress(prev => ({...prev, stage: prev.stage.includes("Fetching") ? prev.stage : "Processing..."}));
             } else if (searchPerformed) {
                 setLoadingStage('');
                 setProgress(prev => ({...prev, stage: `Loaded ${prev.loaded} students.`}));
             }
            return;
        }
        const timer = setTimeout(() => {
            const student = fetchedDataQueue[0];
            // --- UPDATED LOGIC ---
            // Add student to class results (merge handles duplicates)
            setClassResults(prev => mergeAndSortResults(prev, [student]));

            setProgress(prev => {
                const loaded = prev.loaded + 1;
                const percent = prev.total > 0 ? Math.round((loaded / prev.total) * 100) : 0;
                return {
                    ...prev,
                    loaded: loaded,
                    percent: percent > 100 ? 100 : percent,
                    stage: `Processing... (${loaded} / ${prev.total} students found)`
                };
            });
            setFetchedDataQueue(prev => prev.slice(1));
        }, LAZY_LOAD_DELAY); 
        return () => clearTimeout(timer); 
    }, [fetchedDataQueue, isLoading, isLoadingMore, searchPerformed]); // --- UPDATED: Removed regNo dependency


    // --- Search Function ---
    const executeSearch = useCallback(async (isRetry = false) => {
        if (!selectedExamDetails || !regNo || !/^\d{11}$/.test(regNo)) { setError("Please select valid exam & 11-digit reg no."); setIsLoading(false); return; }

        setIsLoading(true); setLoadingStage('Starting search...'); setError(null); setShowLoadMore(false); setFetchedReg2(false);
        if (!isRetry) { setUserResult(null); setClassResults([]); setSearchPerformed(true); setFetchedDataQueue([]); setErrorList([]); }
        else { setError(null); setFetchedDataQueue([]); setErrorList([]); }

        const year = selectedExamDetails.batchYear; const semesterRoman = getRomanSemester(selectedExamDetails.semId); const examHeld = selectedExamDetails.examHeld;
        const params = `reg_no=${regNo}&year=${year}&semester=${semesterRoman}&exam_held=${encodeURIComponent(examHeld)}`;
        setLastSearchParams(params);

        let encounteredError = false;
        let tempErrorList = [];
        let userResultObject = null;
        
        const estTotalBatches = 1 + (60 / BATCH_STEP) + (60 / BATCH_STEP);
        let batchesLoaded = 0;
        setProgress({ percent: 0, loaded: 0, total: 0, stage: 'Initializing...'});

        try {
            // --- USER FETCH (FAST) ---
            setLoadingStage(`Fetching your result (Batch 1/${estTotalBatches})...`);
            const userBatchData = await fetchWorkerData('user', params);
            batchesLoaded++;
            setProgress(prev => ({...prev, percent: Math.round((batchesLoaded / estTotalBatches) * 100), stage: 'Processing user data...'}));
            
            const foundUser = userBatchData.find(r => r.regNo === regNo);
            userResultObject = foundUser || { regNo: regNo, status: 'Not Found', reason: 'Not in initial response' };
            
            // --- FIX 1: "HOSTAGE BUG" ---
            // Set the user's result IMMEDIATELY so they don't leave the page.
            console.log("Displaying User Result NOW.");
            setUserResult(userResultObject);
            // --- END FIX 1 ---

            if (userResultObject?.status !== 'success') {
                 if (userResultObject?.status === 'Error') {
                     encounteredError = true;
                     userBatchData.filter(r => r.status === 'Error').forEach(r => tempErrorList.push(r.regNo));
                 }
                 if (userResultObject.status !== 'Record not found' && userResultObject.status !== 'Not Found') {
                    setError(prev => prev || `Result status for ${regNo}: ${userResultObject?.status}${userResultObject?.reason ? ` - ${userResultObject?.reason}`: ''}`);
                 }
            } else { setError(null); }
            
            let reg1Data = [], leData = [];

            // --- CLASS FETCH (SLOW, IN BACKGROUND) ---
            setLoadingStage('Loading class results (1-60)...');
            reg1Data = await fetchWorkerData('reg1', params);
            batchesLoaded += (60 / BATCH_STEP);
            setProgress(prev => ({...prev, percent: Math.round((batchesLoaded / estTotalBatches) * 100), stage: 'Loading LE results...'}));
            if (reg1Data.some(r => r.status === 'Error')) {
                encounteredError = true;
                tempErrorList = tempErrorList.concat(reg1Data.filter(r => r.status === 'Error').map(r => r.regNo));
            }
            
            setLoadingStage('Loading results (LE 901-960)...');
            leData = await fetchWorkerData('le', params);
            batchesLoaded += (60 / BATCH_STEP);
            setProgress(prev => ({...prev, percent: 100, stage: 'Finalizing...'}));
            if (leData.some(r => r.status === 'Error')) {
                encounteredError = true;
                tempErrorList = tempErrorList.concat(leData.filter(r => r.status === 'Error').map(r => r.regNo));
            }
            
            // --- FIX 2: "MISSING USER BUG" ---
            // Add the user's batch to the class data.
            // This fixes the bug where user '...070' is missing from the list.
            const combinedClassData = [...userBatchData, ...reg1Data, ...leData];
            // --- END FIX 2 ---
            
            // We now filter "Record not found" *here*, so the total is accurate
            const filteredClassData = combinedClassData.filter(r => r.status !== 'Record not found');
            
            const totalStudentsFound = filteredClassData.length;
            setProgress({ percent: 0, loaded: 0, total: totalStudentsFound, stage: `Loading ${totalStudentsFound} students...`});
            
            // Add all results to the lazy-load queue
            setFetchedDataQueue(filteredClassData);
            
            // Show "Load More" button (this logic is good)
            const suffixNum = parseInt(regNo.slice(-3));
            const userIsPotentiallyInReg2 = !isNaN(suffixNum) && suffixNum >= 61 && suffixNum < 900;
            if (userIsPotentiallyInReg2 || (foundUser?.status === 'success')) {
                 setShowLoadMore(true);
            }

        } catch (error) {
            console.error("Critical error during search:", error); setError(`Unexpected error: ${error.message}`); encounteredError = true; setIsLoading(false);
        } finally {
            setIsLoading(false);
            if (encounteredError) {
                 setError(prevError => { const failMsg = "Some results failed. See list below."; return prevError ? (prevError.includes(failMsg) ? prevError : `${prevError} | ${failMsg}`) : failMsg; });
            }
             setErrorList([...new Set(tempErrorList)].sort());
        }
    }, [regNo, selectedExamDetails]);

    // --- Fetch Reg2 Results (Lazy Load One-by-One) ---
    const fetchReg2Results = async () => {
         if (!lastSearchParams) return;
         setIsLoadingMore(true); setLoadingStage('Loading results (61-120)...'); setError(null);
         
         const oldTotal = progress.total;
         const oldLoaded = progress.loaded;
         const newBatches = (120 - 60) / BATCH_STEP;
         const estimatedNewTotal = oldTotal + (newBatches * 4); // Estimate
         setProgress({ percent: Math.round((oldLoaded / estimatedNewTotal) * 100), loaded: oldLoaded, total: estimatedNewTotal, stage: 'Loading results (61-120)...'});
         
         try {
             const reg2Data = await fetchWorkerData('reg2', lastSearchParams);
             const filteredReg2Data = reg2Data.filter(r => r.status !== 'Record not found');
             
             // Get an accurate total
             const accurateTotal = oldLoaded + filteredReg2Data.length;
             setProgress(prev => ({...prev, total: accurateTotal}));

             if (reg2Data.some(r => r.status === 'Error')) {
                  setError("Some results (61-120) failed. Check error list.");
                  setErrorList(prev => [...new Set([...prev, ...reg2Data.filter(r => r.status === 'Error').map(r => r.regNo)])].sort());
             }
             
             // Add new data to the lazy-load queue
             setFetchedDataQueue(prev => [...prev, ...filteredReg2Data]);
             setShowLoadMore(false); setFetchedReg2(true);
         } catch (error) {
              console.error("Critical fetch Reg2:", error); setError(`Failed load (61-120): ${error.message}`);
         } finally {
              setIsLoadingMore(false); 
         }
    };


    // --- Event Handlers ---
    const handleSearch = (e) => { e.preventDefault(); executeSearch(false); };
    const handleRetry = () => { if (lastSearchParams) executeSearch(true); };
    // --- DELETED modal functions ---

    
    // ---
    // ---
    // --- NEW PDF GENERATION ---
    // ---
    // ---
    
    // --- PDF Helper: Add a "Cover Page" (NEW) ---
    const addCoverPage = (doc, allResults) => {
        const examDetails = getSelectedExamDetails();
        doc.setFontSize(22);
        doc.setFont(undefined, 'bold');
        doc.text("BEU Examination Result", doc.internal.pageSize.width / 2, 80, { align: 'center' });
        
        doc.setFontSize(16);
        doc.setFont(undefined, 'normal');
        doc.text(examDetails?.examName || 'Exam', doc.internal.pageSize.width / 2, 100, { align: 'center' });
        
        doc.setFontSize(12);
        doc.autoTable({
            startY: 120,
            theme: 'plain',
            margin: { left: 40, right: 40 },
            body: [
                ['Session', examDetails?.session || 'N/A'],
                ['Exam Held', examDetails?.examHeld || 'N/A'],
                ['Total Students Found', allResults.length],
                ['Generated By', MY_WEBSITE_NAME],
                ['Generated On', new Date().toLocaleDateString('en-GB')],
            ],
            styles: {
                fontSize: 12,
                cellPadding: 4,
            },
            columnStyles: {
                0: { fontStyle: 'bold', minCellWidth: 50 },
                1: { minCellWidth: 80 }
            }
        });
        
        doc.setFontSize(10);
        doc.setTextColor(150);
        doc.text("This document is a compilation of publicly available results.", doc.internal.pageSize.width / 2, 270, { align: 'center' });
        doc.setTextColor(0);
    };

    // --- PDF Helper: Add a "Summary Page" (NEW) ---
    const addSummaryPage = (doc, allResults) => {
        doc.addPage();
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.text("Result Summary", 14, 22);
        
        const successStudents = allResults.filter(r => r.status === 'success').map(r => r.regNo);
        const errorStudents = allResults.filter(r => r.status === 'Error').map(r => r.regNo);
        // We ignore "Record not found" and "Not Found" as requested

        let yPos = 40;

        if (successStudents.length > 0) {
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(0, 100, 0); // Green
            doc.text(`Successful Students (${successStudents.length})`, 14, yPos);
            yPos += 8;
            
            doc.setFontSize(9);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(0);
            doc.autoTable({
                body: chunkArray(successStudents, 5), // 5 columns
                startY: yPos,
                theme: 'plain',
                styles: { fontSize: 9, cellPadding: 1 },
            });
            yPos = doc.lastAutoTable.finalY + 15;
        }

        if (errorStudents.length > 0) {
            doc.setFontSize(14);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(220, 53, 69); // Red
            doc.text(`Failed to Fetch (Error/Timeout) (${errorStudents.length})`, 14, yPos);
            yPos += 8;
            
            doc.setFontSize(9);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(0);
            doc.autoTable({
                body: chunkArray(errorStudents, 5), // 5 columns
                startY: yPos,
                theme: 'plain',
                styles: { fontSize: 9, cellPadding: 1 },
            });
        }
    };
    
    // --- PDF Helper: Chunk array for columns ---
    const chunkArray = (arr, chunkSize) => {
        const chunks = [];
        for (let i = 0; i < arr.length; i += chunkSize) {
            chunks.push(arr.slice(i, i + chunkSize));
        }
        return chunks;
    };

    // --- PDF Helper: Draw the NEW "fast as fuck" demo page (REBUILT) ---
    const drawStudentPdfPage = (doc, studentData, examDetails) => {
        const data = studentData.data;
        if (!data) return; // Don't add pages for error students
        
        doc.addPage();
        doc.setFontSize(14);
        doc.setFont(undefined, 'bold');
        doc.text("BIHAR ENGINEERING UNIVERSITY, PATNA", doc.internal.pageSize.width / 2, 20, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setFont(undefined, 'normal');
        doc.text(examDetails?.examName || 'Exam Result', doc.internal.pageSize.width / 2, 28, { align: 'center' });

        // --- Student Info Table (2-column layout) ---
        doc.autoTable({
            startY: 40,
            theme: 'plain',
            body: [
                ['Registration No:', data.redg_no || 'N/A', 'Semester:', data.semester || 'N/A'],
                ['Student Name:', data.name || 'N/A', '', ''],
                ['College Name:', data.college_name || 'N/A', '', ''],
                ['Course Name:', data.course || 'N/A', '', ''],
            ],
            styles: {
                fontSize: 9,
                cellPadding: 1.5,
            },
            columnStyles: {
                0: { fontStyle: 'bold', minCellWidth: 35 },
                1: { minCellWidth: 60 },
                2: { fontStyle: 'bold', minCellWidth: 25 },
                3: { minCellWidth: 40 }
            }
        });
        
        let yPos = doc.lastAutoTable.finalY + 5;

        // --- Theory Subjects ---
        if (data.theorySubjects?.length > 0) {
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.text("Theory Subjects", 14, yPos);
            yPos += 3;
            doc.autoTable({
                head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]],
                body: data.theorySubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']),
                startY: yPos,
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 2 }, // Better padding
                headStyles: { fontSize: 9, fillColor: [220, 220, 220], textColor: 0 },
            });
            yPos = doc.lastAutoTable.finalY + 5;
        }

        // --- Practical Subjects ---
        if (data.practicalSubjects?.length > 0) {
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.text("Practical Subjects", 14, yPos);
            yPos += 3;
            doc.autoTable({
                head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]],
                body: data.practicalSubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']),
                startY: yPos,
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 2 }, // Better padding
                headStyles: { fontSize: 9, fillColor: [220, 220, 220], textColor: 0 },
            });
            yPos = doc.lastAutoTable.finalY + 5;
        }
        
        // --- SMART LOGIC: Get current SGPA from array ---
        const currentSem = getArabicSemester(data.semester);
        const currentSgpa = data.sgpa?.[currentSem - 1] ?? 'N/A';
        const currentCgpa = data.cgpa || 'N/A';

        // --- Remarks Table (SGPA/CGPA/Result) ---
        doc.autoTable({
            startY: yPos,
            theme: 'grid',
            body: [
                ['SGPA', currentSgpa],
                ['CGPA', currentCgpa],
                ['Result', data.fail_any || 'N/A'],
            ],
            styles: {
                fontSize: 10,
                cellPadding: 3,
                halign: 'center'
            },
            columnStyles: {
                0: { fontStyle: 'bold', fillColor: [242, 242, 242] },
                1: { fontStyle: 'bold' }
            },
            didParseCell: (hookData) => {
                if (hookData.column.index === 1 && hookData.row.index === 2) {
                    hookData.cell.styles.textColor = (data.fail_any === 'PASS') ? [0, 100, 0] : [220, 53, 69];
                }
            }
        });
        yPos = doc.lastAutoTable.finalY;

        // --- SMART LOGIC: Failed Subject 3-per-line ---
        if (data.fail_any && data.fail_any !== 'PASS') {
            const allSubjects = [...(data.theorySubjects || []), ...(data.practicalSubjects || [])];
            const failedCodes = data.fail_any.replace("FAIL:", "").split(',').map(c => c.trim());
            const failedSubjects = failedCodes.map(code => {
                const subject = allSubjects.find(s => s.code === code);
                return subject ? `${subject.name} (${subject.code})` : `Unknown (${code})`;
            }).filter(Boolean);

            if (failedSubjects.length > 0) {
                yPos += 5;
                doc.setFontSize(11);
                doc.setFont(undefined, 'bold');
                doc.text("Remarks: FAIL (Back Paper)", 14, yPos);
                yPos += 3;
                
                // Chunk into rows of 3
                const failedRows = chunkArray(failedSubjects, 3);
                
                doc.autoTable({
                    startY: yPos,
                    theme: 'grid',
                    body: failedRows,
                    styles: {
                        fontSize: 9,
                        cellPadding: 3,
                        textColor: [220, 53, 69], // Red text
                        fillColor: [248, 215, 218]  // Light red bg
                    },
                    headStyles: { hidden: true }
                });
                yPos = doc.lastAutoTable.finalY;
            }
        }
        
        // --- SGPA History Table ---
        if (data.sgpa?.some(s => s !== null)) {
            yPos += 5;
            doc.setFontSize(11);
            doc.setFont(undefined, 'bold');
            doc.text("SGPA History", 14, yPos);
            yPos += 3;
            
            const sgpaCols = [["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]];
            const sgpaRowPadded = [...(data.sgpa || [])];
            while(sgpaRowPadded.length < 8) sgpaRowPadded.push(null);
            const sgpaRow = sgpaRowPadded.map(s => s ?? 'NA');
            
            doc.autoTable({
                head: sgpaCols,
                body: [sgpaRow],
                startY: yPos,
                theme: 'grid',
                styles: { fontSize: 9, cellPadding: 2, halign: 'center' },
                headStyles: { fontSize: 9, fontStyle: 'bold', fillColor: [242, 242, 242], textColor: 0 }
            });
            yPos = doc.lastAutoTable.finalY;
        }

        // --- Footer (REBUILT) ---
        const pageCount = doc.internal.getNumberOfPages();
        doc.setFontSize(9);
        doc.setTextColor(100);
        doc.text(
            `Page ${pageCount} | Generated by ${MY_WEBSITE_NAME} - ${new Date().toLocaleDateString('en-GB')}`,
            doc.internal.pageSize.width / 2,
            doc.internal.pageSize.height - 10,
            { align: 'center' }
        );
        doc.setTextColor(0);
    };

    // --- PDF Main: Generate Class PDF (REBUILT) ---
    const generatePdf = () => {
         let resultsForPdf = [];
         if (userResult?.status === 'success') { resultsForPdf.push(userResult); }
         resultsForPdf = [...resultsForPdf, ...classResults];
         const successfulResults = resultsForPdf.filter(res => res.status === 'success');
         const allFetchedResults = Array.from(new Map(resultsForPdf.map(item => [item.regNo, item])).values());
         const uniqueSuccessResults = Array.from(new Map(successfulResults.map(item => [item.regNo, item])).values());
         uniqueSuccessResults.sort((a,b) => (a.regNo || "").localeCompare(b.regNo || ""));

        if (uniqueSuccessResults.length === 0) { alert("No successful results found to generate PDF."); return; }
        
        alert(`Generating PDF... This may take a moment for ${uniqueSuccessResults.length} students.`);

        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const examDetails = getSelectedExamDetails();
        
        // --- NEW PAGE 1: Cover Page ---
        addCoverPage(doc, uniqueSuccessResults);
        
        // --- NEW PAGE 2: Summary Page ---
        addSummaryPage(doc, allFetchedResults);

        // --- Page 3+: Student Result Pages ---
         uniqueSuccessResults.forEach((student) => {
             console.log(`PDF: Adding page for ${student.regNo}`);
             drawStudentPdfPage(doc, student, examDetails);
         });

        doc.save(`BEU_Results_${examDetails?.semId || 'Sem'}_${examDetails?.batchYear || 'Year'}_FullClass.pdf`);
    };

    // --- PDF Main: Generate Single PDF (REBUILT) ---
    const generateSinglePdf = () => {
         if (!userResult || userResult.status !== 'success' || !userResult.data) { alert('Your result was not found successfully.'); return; }
         
         const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' }); 
         const examDetails = getSelectedExamDetails();
         
         drawStudentPdfPage(doc, userResult, examDetails);
         
         doc.save(`BEU_Result_${userResult.regNo}_${selectedExamDetails?.semId || 'Sem'}.pdf`);
    };

     // ---
     // ---
     // --- END NEW PDF GENERATION ---
     // ---
     // ---


     // ---
     // ---
     // --- NEW "FAST AS FUCK" RESULT BLOCK ---
     // ---
     // ---
     
     // --- NEW Helper: Render Failed Subjects (3-per-line) ---
     const FailedSubjectsBlock = ({ data }) => {
        if (!data.fail_any || data.fail_any === 'PASS') {
            return null; // Don't show if pass
        }
        
        const allSubjects = [...(data.theorySubjects || []), ...(data.practicalSubjects || [])];
        const failedCodes = data.fail_any.replace("FAIL:", "").split(',').map(c => c.trim());
        
        const failedSubjects = failedCodes.map(code => {
            const subject = allSubjects.find(s => s.code === code);
            return subject ? { code: code, name: subject.name, type: (subject.ia === undefined ? 'Practical' : 'Theory') } : { code: code, name: `Unknown (${code})`, type: 'Unknown' };
        }).filter(Boolean);

        if (failedSubjects.length === 0) return null;

        // --- SMART LOGIC: Chunk into rows of 3 ---
        const chunkedFailSubjects = [];
        for (let i = 0; i < failedSubjects.length; i += 3) {
            chunkedFailSubjects.push(failedSubjects.slice(i, i + 3));
        }

        return (
            <div className={styles.failRemarks}>
                <h4>Remarks: FAIL (Back Paper)</h4>
                {chunkedFailSubjects.map((row, index) => (
                    <div key={index} className={styles.failedSubjectRow}>
                        {row.map(sub => (
                            <div key={sub.code} className={styles.failedSubject}>
                                {sub.name} <span>({sub.type})</span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        );
     };

     // --- NEW Helper: Render a Single "Fast as Fuck" Result Card ---
     const StudentResultBlock = ({ studentResult, isUser = false }) => {
         if (!studentResult.data) {
             // This renders the card for Error/Not Found students
             if (studentResult.status === 'Error') {
                 return (
                    <div className={`${styles.resultPage} ${isUser ? styles.isUserResult : ''}`}>
                         <div className={styles.resultHeader}>
                            <h2>{studentResult.regNo}</h2>
                         </div>
                         <div className={styles.resultBody}>
                             <p className={styles.failStatus}><strong>Status:</strong> Error - {studentResult.reason || 'Failed to fetch'}</p>
                         </div>
                    </div>
                 );
             }
             // We don't render "Record not found"
             return null;
         }
         
         // This is a successful result
         const data = studentResult.data;
         const examDetails = getSelectedExamDetails();
         
         // --- SMART LOGIC: Get current SGPA from array ---
         const currentSem = getArabicSemester(data.semester);
         const currentSgpa = data.sgpa?.[currentSem - 1] ?? 'N/A';
         const currentCgpa = data.cgpa || 'N/A';
         
         const sgpaRowPadded = [...(data.sgpa || [])];
         while(sgpaRowPadded.length < 8) sgpaRowPadded.push(null);
         const sgpaRow = sgpaRowPadded.map(s => s ?? 'NA');

         return (
             <div className={`${styles.resultPage} ${isUser ? styles.isUserResult : ''}`}>
                <div className={styles.resultHeader}>
                    <h2>BIHAR ENGINEERING UNIVERSITY, PATNA</h2>
                    <p>{examDetails?.examName || 'Exam Result'}</p>
                </div>

                <div className={styles.resultBody}>
                    <table className={styles.studentInfo}>
                        <tbody>
                            <tr>
                                <td>Registration No:</td>
                                <td>{data.redg_no}</td>
                                <td>Semester:</td>
                                <td>{data.semester}</td>
                            </tr>
                            <tr>
                                <td>Student Name:</td>
                                <td colSpan="3">{data.name}</td>
                            </tr>
                            <tr>
                                <td>College Name:</td>
                                <td colSpan="3">{data.college_name} ({data.college_code})</td>
                            </tr>
                             <tr>
                                <td>Course Name:</td>
                                <td colSpan="3">{data.course} ({data.course_code})</td>
                            </tr>
                        </tbody>
                    </table>

                    {data.theorySubjects?.length > 0 && (<>
                        <h3>Theory Subjects</h3>
                        <table className={styles.marksTable}>
                            <thead><tr><th>Code</th><th>Subject Name</th><th>ESE</th><th>IA</th><th>Total</th><th>Grade</th><th>Credit</th></tr></thead>
                            <tbody>
                                {data.theorySubjects.map(s => <tr key={s.code}><td>{s.code}</td><td>{s.name}</td><td>{s.ese??'-'}</td><td>{s.ia??'-'}</td><td>{s.total??'-'}</td><td>{s.grade??'-'}</td><td>{s.credit??'-'}</td></tr>)}
                            </tbody>
                        </table>
                    </>)}
                    
                    {data.practicalSubjects?.length > 0 && (<>
                        <h3>Practical Subjects</h3>
                        <table className={styles.marksTable}>
                            <thead><tr><th>Code</th><th>Name</th><th>ESE</th><th>IA</th><th>Total</th><th>Grade</th><th>Credit</th></tr></thead>
                            <tbody>
                                {data.practicalSubjects.map(s => <tr key={s.code}><td>{s.code}</td><td>{s.name}</td><td>{s.ese??'-'}</td><td>{s.ia??'-'}</td><td>{s.total??'-'}</td><td>{s.grade??'-'}</td><td>{s.credit??'-'}</td></tr>)}
                            </tbody>
                        </table>
                    </>)}

                    <table className={styles.remarksTable}>
                        <tbody>
                            <tr>
                                <td>SGPA</td>
                                <td>{currentSgpa}</td>
                                <td>CGPA</td>
                                <td>{currentCgpa}</td>
                                <td>Result</td>
                                <td className={data.fail_any?.includes('PASS') ? styles.passStatus : styles.failStatus}>
                                    {data.fail_any || 'N/A'}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                    
                    {/* --- NEW Failed Subject Block --- */}
                    <FailedSubjectsBlock data={data} />
                    
                    {data.sgpa?.some(s => s !== null) && (
                        <table className={styles.sgpaHistoryTable}>
                            <thead><tr><th>I</th><th>II</th><th>III</th><th>IV</th><th>V</th><th>VI</th><th>VII</th><th>VIII</th></tr></thead>
                            <tbody><tr>{sgpaRow.map((s, i) => <td key={i}>{s}</td>)}</tr></tbody>
                        </table>
                    )}
                </div>
                
                <div className={styles.resultFooter}>
                    Generated by {MY_WEBSITE_NAME}
                </div>
             </div>
         );
     };


    // ---
    // ---
    // --- END NEW RESULT BLOCK ---
    // ---
    // ---


    // --- JSX (Main Page Render) ---
    return (
        <div className={styles.container}>
            <h1 className={styles.title}>{selectedExamDetails?.examName || 'B.Tech Result Finder'}</h1>
            <p style={{textAlign: 'center', marginTop: '-25px', marginBottom: '25px', color: '#555'}}>
                {selectedExamDetails ? `Session: ${selectedExamDetails.session} | Exam Held: ${selectedExamDetails.examHeld}` : (selectedExamIdProp ? "Loading exam details..." : "No exam selected.")}
            </p>

            {/* Input Form */}
            <form onSubmit={handleSearch} className={styles.form}>
                 <div className={styles.formGroup}>
                     <label htmlFor="regNoInput">Registration No:</label>
                    <input id="regNoInput" type="text" value={regNo} onChange={(e) => setRegNo(e.target.value.replace(/\D/g, ''))} required pattern="\d{11}" maxLength="11" title="Enter 11 digit Reg No" placeholder="e.g., 22104134001" />
                </div>
                <div className={styles.buttonGroup}>
                    <button type="submit" disabled={isLoading || isLoadingMore || !selectedExamDetails || !regNo} className={`${styles.button} ${styles.buttonPrimary}`} >
                         {isLoading || isLoadingMore ? 'Loading...' : 'Search Results'}
                    </button>
                    {searchPerformed && !isLoading && !isLoadingMore && (userResult?.status === 'success') && (
                        <button type="button" onClick={generateSinglePdf} className={`${styles.button} ${styles.buttonSecondary}`}> Download Your PDF </button>
                    )}
                    {searchPerformed && !isLoading && !isLoadingMore && (classResults.length > 0 || userResult?.status === 'success') && (
                        <button type="button" onClick={generatePdf} className={`${styles.button} ${styles.buttonSuccess}`} > Download Class PDF </button>
                    )}
                    {error && searchPerformed && !isLoading && !isLoadingMore && (
                        <button type="button" onClick={handleRetry} className={`${styles.button} ${styles.buttonWarning}`} > Re-Check Failed </button>
                    )}
                </div>
            </form>

            {/* --- Status Messages & Progress Bar --- */}
            {(isLoading || isLoadingMore) && (
                <div className={styles.loader}>
                    <div style={{fontWeight: 'bold', fontSize: '1.1em', marginBottom: '10px'}}>{loadingStage || 'Loading...'}</div>
                    {searchPerformed && (isLoading || isLoadingMore) && progress.total > 0 && (
                        <>
                            <div className={styles.progressBarContainer}>
                                <div className={styles.progressBar} style={{ width: `${progress.percent}%` }}></div>
                            </div>
                            <div className={styles.progressText}>
                                {progress.percent < 100 ? 
                                `Processing: ${progress.loaded} / ${progress.total} students found...` :
                                `All ${progress.loaded} students processed!`}
                            </div>
                        </>
                    )}
                </div>
            )}
            {error && <div className={styles.errorBox}>⚠️ {error}</div>}

            
            {/* ---
            --- NEW "FAST AS FUCK" RENDER
            ---
            */}

            {/* --- User Result Display (NEW) --- */}
            {userResult && (
                <>
                    <h2 className={styles.tableTitle} style={{marginTop: '2rem'}}>Your Result</h2>
                    <StudentResultBlock studentResult={userResult} isUser={true} />
                </>
            )}

             {/* --- Load More Button --- */}
             {searchPerformed && !isLoading && showLoadMore && !isLoadingMore && !fetchedReg2 && (
                 <div className={styles.loadMoreContainer}>
                    <p>Showing results for 1-60 & LE students. Click below to load the remaining results for potentially larger colleges (61-120).</p>
                    <button onClick={fetchReg2Results} className={`${styles.button} ${styles.buttonSecondary}`}>
                        Load More Results (61-120)
                    </button>
                 </div>
             )}
             {searchPerformed && !isLoading && !isLoadingMore && fetchedReg2 && <div className={styles.progressInfo}>All available results (1-120 & LE) loaded.</div>}

            {/* --- Class Results (NEW) --- */}
             {searchPerformed && (classResults.length > 0 || (isLoading || isLoadingMore)) && (
                <h2 className={styles.tableTitle}>{ (isLoading || isLoadingMore) ? 'Loading Class Results...' : 'Class Results'}</h2>
             )}
            
            {/* This is where the lazy-load adds the new result blocks */}
            {classResults
                .filter(result => result.regNo !== userResult?.regNo) // Don't show user again
                .map((result, index) => (
                    <StudentResultBlock key={result.regNo || `error-${index}`} studentResult={result} />
            ))}
            
            {/* --- DELETED old table and modal --- */}

            
            {/* --- Error List Box --- */}
            {searchPerformed && !isLoading && !isLoadingMore && errorList.length > 0 && (
                 <div className={`${styles.errorBox} ${styles.errorListBox}`}>
                    <p>The following registration numbers encountered temporary errors (e.g., Timeout) and were not loaded:</p>
                    <ul style={{fontSize: '0.9em', listStyle: 'none', paddingLeft: '10px', columns: 3, columnGap: '10px'}}>
                         {[...new Set(errorList)].map(reg => <li key={reg}>- {reg}</li>)}
                    </ul>
                     <p style={{marginTop: '10px', fontStyle: 'italic'}}>Click "Re-Check Failed" to try fetching these (and other failed ranges) again.</p>
                 </div>
            )}

            {/* No results message */}
            {searchPerformed && !isLoading && !userResult && classResults.length === 0 && !error && <p>No results found or loaded yet for the class.</p>}

        </div>
    );
};

export default ResultFinder;
