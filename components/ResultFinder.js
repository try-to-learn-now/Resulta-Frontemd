// components/ResultFinder.js
import React, { useState, useEffect, useCallback } from 'react';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import styles from '../styles/ResultFinder.module.css';

// --- Configuration: Your Final Cloudflare Worker URLs ---
// IMPORTANT: Replace with your actual deployed worker URLs
const WORKER_URLS = {
    user: "https://resulta-user.walla.workers.dev/api/result", // REPLACE
    reg1: "https://resulta-reg1.walla.workers.dev/api/result", // REPLACE
    reg2: "https://resulta-reg2.walla.workers.dev/api/result", // REPLACE
    le:   "https://resulta-le.walla.workers.dev/api/result",   // REPLACE
};
const BEU_EXAM_LIST_URL = 'https://beu-bih.ac.in/backend/v1/result/sem-get';
const LAZY_LOAD_DELAY = 40; // Milliseconds between showing each student

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
         const batchSize = 5; 
         const baseNum = parseInt(baseRegNo.slice(-3)) || 0;
         const batchRegNos = Array.from({ length: batchSize }, (_, i) => `${baseRegNo.slice(0,-3)}${String(baseNum + i).padStart(3,'0')}`);
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
    const [modalOpen, setModalOpen] = useState(false);
    const [selectedStudentData, setSelectedStudentData] = useState(null);

    // --- Fetch Exam Details ---
    useEffect(() => {
        if (!selectedExamIdProp) return;
        const fetchExamDetails = async () => {
            console.log(`Fetching details for examId: ${selectedExamIdProp}`);
            setError(null); 
            try {
                const response = await fetch(BEU_EXAM_LIST_URL);
                if (!response.ok) throw new Error(`BEU API Error: ${response.status}`);
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
            if(student.regNo !== regNo) {
                 setClassResults(prev => mergeAndSortResults(prev, [student]));
            }
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
    }, [fetchedDataQueue, regNo, isLoading, isLoadingMore, searchPerformed]);


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
        
        const estTotalBatches = 1 + 12 + 12; // User(1) + Reg1(12) + LE(12)
        let batchesLoaded = 0;
        setProgress({ percent: 0, loaded: 0, total: 0, stage: 'Initializing...'});

        try {
            setLoadingStage('Fetching your result (Batch 1/25)...');
            const userBatchData = await fetchWorkerData('user', params);
            batchesLoaded++;
            setProgress(prev => ({...prev, percent: Math.round((batchesLoaded / estTotalBatches) * 100), stage: 'Processing user data...'}));
            
            const foundUser = userBatchData.find(r => r.regNo === regNo);
            userResultObject = foundUser || { regNo: regNo, status: 'Not Found', reason: 'Not in initial response' };
            
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
            
            console.log("Displaying User Result Now (After Hold)");
            setUserResult(userResultObject);
            
            const combinedClassData = [...reg1Data, ...leData];
            const filteredClassData = combinedClassData.filter(r => r.status !== 'Record not found');
            
            const totalStudentsFound = filteredClassData.length;
            setProgress({ percent: 0, loaded: 0, total: totalStudentsFound, stage: `Loading ${totalStudentsFound} students...`});
            
            setFetchedDataQueue(filteredClassData);
            
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
         const estimatedNewTotal = oldTotal + (newBatches * 4);
         setProgress({ percent: Math.round((oldLoaded / estimatedNewTotal) * 100), loaded: oldLoaded, total: estimatedNewTotal, stage: 'Loading results (61-120)...'});
         
         try {
             const reg2Data = await fetchWorkerData('reg2', lastSearchParams);
             const filteredReg2Data = reg2Data.filter(r => r.status !== 'Record not found');
             
             const accurateTotal = oldLoaded + filteredReg2Data.length;
             setProgress(prev => ({...prev, total: accurateTotal}));

             if (reg2Data.some(r => r.status === 'Error')) {
                  setError("Some results (61-120) failed. Check error list.");
                  setErrorList(prev => [...new Set([...prev, ...reg2Data.filter(r => r.status === 'Error').map(r => r.regNo)])].sort());
             }
             
             setFetchedDataQueue(prev => [...prev, ...filteredReg2Data]);
             setShowLoadMore(false); setFetchedReg2(true);
         } catch (error) {
              console.error("Critical fetch Reg2:", error); setError(`Failed load (61-120): ${error.message}`);
         } finally {
              setIsLoadingMore(false); 
         }
    };


    // --- Event Handlers & Modal ---
    const handleSearch = (e) => { e.preventDefault(); executeSearch(false); };
    const handleRetry = () => { if (lastSearchParams) executeSearch(true); };
    const openModal = (studentResult) => {
        if (studentResult?.status === 'success' && studentResult.data) { setSelectedStudentData(studentResult.data); setModalOpen(true); }
        else if (studentResult){ alert(`Cannot show details for ${studentResult.regNo}: Status is ${studentResult.status}`); }
    };
    const closeModal = () => setModalOpen(false);


    // --- PDF Generation ---
    const generatePdf = () => {
         let resultsForPdf = [];
         if (userResult?.status === 'success') { resultsForPdf.push(userResult); }
         resultsForPdf = [...resultsForPdf, ...classResults];
         const successfulResults = resultsForPdf.filter(res => res.status === 'success');
         const uniqueResults = Array.from(new Map(successfulResults.map(item => [item.regNo, item])).values());
         uniqueResults.sort((a,b) => (a.regNo || "").localeCompare(b.regNo || ""));

        if (uniqueResults.length === 0) { alert("No successful results found to generate PDF."); return; }
        
        alert(`Generating PDF... This may take a moment for ${uniqueResults.length} students.`);

        const doc = new jsPDF({ orientation: 'landscape' });
        const tableColumn = ["Reg No", "Name", "SGPA", "CGPA", "Result"];
        const tableRows = uniqueResults.map(result => {
             const currentSem = getArabicSemester(result.data?.semester);
             return [ result.regNo, result.data?.name||'N/A', result.data?.sgpa?.[currentSem - 1] ?? 'N/A', result.data?.cgpa||'N/A', result.data?.fail_any||'N/A', ]; });

        const examDetails = getSelectedExamDetails();
        doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text(`BEU Results - ${examDetails?.examName || 'Exam'}`, 14, 22);
        doc.setFont(undefined, 'normal'); doc.setFontSize(11); doc.setTextColor(100);
        doc.text(`Session: ${examDetails?.session || 'N/A'} | Exam Held: ${examDetails?.examHeld || 'N/A'}`, 14, 28); doc.setTextColor(0);
         doc.text(`Total Students Found: ${uniqueResults.length}`, 14, 34);

        doc.autoTable({ head: [tableColumn], body: tableRows, startY: 40, theme: 'grid', headStyles: { fillColor: [22, 160, 133], textColor: 255 }, styles: { fontSize: 8, cellPadding: 1.5 }, alternateRowStyles: { fillColor: [245, 245, 245] }, didDrawPage: (data) => { doc.setFontSize(8); doc.setTextColor(100); doc.text('Page ' + doc.internal.getNumberOfPages() + ' | Generated via BeuMate (Concept) - ' + new Date().toLocaleString(), data.settings.margin.left, doc.internal.pageSize.height - 10); } });

         console.log(`PDF: Adding ${uniqueResults.length} detailed pages...`);
         uniqueResults.forEach((student, index) => {
             console.log(`PDF: Adding page for ${student.regNo}`);
             addStudentDetailToPdf(doc, student.data, index + 2, examDetails, true);
         });

        doc.save(`BEU_Results_${examDetails?.semId || 'Sem'}_${examDetails?.batchYear || 'Year'}_FullClass.pdf`);
    };

    const generateSinglePdf = () => {
         if (!userResult || userResult.status !== 'success' || !userResult.data) { alert('Your result was not found successfully.'); return; }
          const doc = new jsPDF({ orientation: 'portrait' }); 
          addStudentDetailToPdf(doc, userResult.data, 1, getSelectedExamDetails(), true);
          doc.save(`BEU_Result_${userResult.regNo}_${selectedExamDetails?.semId || 'Sem'}.pdf`);
    };

     // Helper to add detailed student result page(s) to PDF
     const addStudentDetailToPdf = (doc, data, pageNum, examDetails, addWatermark = false) => {
          let yPos = 20; const pageHeight = doc.internal.pageSize.height; const bottomMargin = 20; const leftMargin = 14; const rightMargin = doc.internal.pageSize.width - 14;
        if (!examDetails) examDetails = getSelectedExamDetails();

        doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text("BIHAR ENGINEERING UNIVERSITY, PATNA", doc.internal.pageSize.width / 2, yPos, { align: 'center' }); yPos += 6;
        doc.setFontSize(12); doc.setFont(undefined, 'normal'); doc.text(examDetails?.examName || 'Exam Result', doc.internal.pageSize.width / 2, yPos, { align: 'center' }); yPos += 10;

        doc.setFontSize(10); doc.text(`Registration No: ${data.redg_no || 'N/A'}`, leftMargin, yPos); doc.text(`Semester: ${data.semester || 'N/A'}`, rightMargin - 40, yPos); yPos += 6; doc.text(`Student Name: ${data.name || 'N/A'}`, leftMargin, yPos); yPos += 6; doc.text(`College: ${data.college_name || 'N/A'} (${data.college_code || 'N/A'})`, leftMargin, yPos); yPos += 6; doc.text(`Course: ${data.course || 'N/A'} (${data.course_code || 'N/A'})`, leftMargin, yPos); yPos += 10;

        const checkPageBreak = (currentY, requiredHeight) => { if (currentY + requiredHeight > pageHeight - bottomMargin) { doc.addPage(); return 20; } return currentY; };
        const allSubjects = [...(data.theorySubjects || []), ...(data.practicalSubjects || [])];

        if (data.theorySubjects?.length > 0) { yPos = checkPageBreak(yPos, (data.theorySubjects.length + 1) * 7 + 15); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("Theory Subjects", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal'); doc.autoTable({ head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]], body: data.theorySubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']), startY: yPos, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fontSize: 8, fillColor: [220, 220, 220], textColor: 0 }, alternateRowStyles: { fillColor: [248, 248, 248] }, pageBreak: 'auto', bodyStyles: { minCellHeight: 6 } }); yPos = doc.lastAutoTable.finalY + 8; }

        if (data.practicalSubjects?.length > 0) { yPos = checkPageBreak(yPos, (data.practicalSubjects.length + 1) * 7 + 15); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("Practical Subjects", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal'); doc.autoTable({ head: [["Code", "Subject Name", "ESE", "IA", "Total", "Grade", "Credit"]], body: data.practicalSubjects.map(sub => [sub.code, sub.name, sub.ese ?? '-', sub.ia ?? '-', sub.total ?? '-', sub.grade ?? '-', sub.credit ?? '-']), startY: yPos, theme: 'grid', styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fontSize: 8, fillColor: [220, 220, 220], textColor: 0 }, alternateRowStyles: { fillColor: [248, 248, 248] }, pageBreak: 'auto', bodyStyles: { minCellHeight: 6 } }); yPos = doc.lastAutoTable.finalY + 10; }

        yPos = checkPageBreak(yPos, 30); doc.setFontSize(10); const currentSem = getArabicSemester(data.semester); doc.text(`SGPA (Sem ${data.semester || '?'}): ${data.sgpa?.[currentSem - 1] ?? 'N/A'}`, leftMargin, yPos); yPos += 6; doc.text(`Overall CGPA: ${data.cgpa || 'N/A'}`, leftMargin, yPos); yPos += 6; doc.setFont(undefined, 'bold'); doc.text(`Final Result Status: ${data.fail_any || 'N/A'}`, leftMargin, yPos); doc.setFont(undefined, 'normal'); yPos += 10;

        if (data.sgpa?.some(s => s !== null)) { yPos = checkPageBreak(yPos, 25); doc.setFontSize(11); doc.setFont(undefined, 'bold'); doc.text("SGPA History", leftMargin, yPos); yPos += 7; doc.setFont(undefined, 'normal'); const sgpaCols = [["I", "II", "III", "IV", "V", "VI", "VII", "VIII"]]; const sgpaRowPadded = [...(data.sgpa || [])]; while(sgpaRowPadded.length < 8) sgpaRowPadded.push(null); const sgpaRow = sgpaRowPadded.map(s => s ?? 'NA'); doc.autoTable({ head: sgpaCols, body: [sgpaRow], startY: yPos, theme: 'plain', styles: { fontSize: 9, cellPadding: 1, halign: 'center' }, headStyles: { fontSize: 9, fontStyle: 'bold' } }); yPos = doc.lastAutoTable.finalY + 8; }

         if (data.fail_any && data.fail_any !== 'PASS') { 
             yPos = checkPageBreak(yPos, 15);
             doc.setFontSize(10); doc.setTextColor(255, 0, 0); doc.setFont(undefined, 'bold');
             doc.text(`Remarks: ${data.fail_any.split(':')[0]}`, leftMargin, yPos); yPos+=6;
             
             const failedCodes = data.fail_any.replace("FAIL:", "").replace(/\s/g, "").split(',').map(code => code.trim());
             failedCodes.forEach(code => {
                 if(!code) return;
                 const subject = allSubjects.find(s => s.code === code);
                 if(subject) {
                     yPos = checkPageBreak(yPos, 6);
                     doc.setFont(undefined, 'normal'); doc.setTextColor(150, 0, 0);
                     doc.text(`- ${subject.name} (${subject.code})`, leftMargin + 5, yPos); yPos+=6;
                 } else {
                     yPos = checkPageBreak(yPos, 6);
                     doc.setFont(undefined, 'normal'); doc.setTextColor(150, 0, 0);
                     doc.text(`- Unknown Subject (${code})`, leftMargin + 5, yPos); yPos+=6;
                 }
             });
             doc.setTextColor(0); doc.setFont(undefined, 'normal'); 
         }

         if(examDetails?.publishDate){ yPos = checkPageBreak(yPos, 10); doc.setFontSize(9); doc.setTextColor(100); doc.text(`Publish Date: ${new Date(examDetails.publishDate).toLocaleDateString()}`, leftMargin, yPos); doc.setTextColor(0); yPos += 10; }

          if (addWatermark) {
             const pageCount = doc.internal.getNumberOfPages();
             const startPage = pageNum === 1 ? 1 : doc.internal.getNumberOfPages(); 
             for(let i = startPage; i <= doc.internal.getNumberOfPages(); i++) {
                doc.setPage(i);
                doc.setFontSize(40); doc.setTextColor(230, 230, 230); doc.setFont(undefined, 'bold');
                doc.text('resulta.beunotes.workers.dev', doc.internal.pageSize.width / 2, doc.internal.pageSize.height / 2, { angle: -45, align: 'center' });
             }
             doc.setTextColor(0); doc.setFont(undefined, 'normal');
          }

          doc.setPage(doc.internal.getNumberOfPages()); 
          yPos = doc.internal.pageSize.height - 10;
          doc.setFontSize(8); doc.setTextColor(100);
          const pageStr = pageNum ? `Page ${pageNum} | ` : '';
          doc.text(pageStr + 'Generated via BeuMate (Concept) - ' + new Date().toLocaleString(), leftMargin, yPos);
     };

     // --- Helper: Render Full Detailed Result (React Component) ---
     const DetailedResultView = ({ studentResult }) => {
         if (!studentResult || !studentResult.data) {
             // This component should only be called with success data
             if (studentResult.status === 'Record not found') { return <div style={{padding: '0 20px 15px 20px'}}><p><strong>Status:</strong> Record not found for this exam.</p></div>; }
             if (studentResult.status === 'Error') { return <div style={{padding: '0 20px 15px 20px'}}><p><strong>Status:</strong> <span className={styles.failStatus}>Error</span> - {studentResult.reason || 'Failed to fetch'}</p></div>; }
             if (studentResult.status === 'Not Found') { return <div style={{padding: '0 20px 15px 20px'}}><p><strong>Status:</strong> Not Found - Your registration number was not in the initial batch.</p></div>; }
             return <div style={{padding: '0 20px 15px 20px'}}><p>Loading details...</p></div>;
         }
         
         const data = studentResult.data;
         const examDetails = getSelectedExamDetails();
         const allSubjects = [...(data.theorySubjects || []), ...(data.practicalSubjects || [])];

         return (
             <div className={styles.detailedResultScrollable}>
                 <p><strong>Registration No:</strong> {data.redg_no} &nbsp;&nbsp;&nbsp;|&nbsp;&nbsp;&nbsp; <strong>Semester:</strong> {data.semester}</p>
                 <p><strong>Student Name:</strong> {data.name}</p>
                 <p><strong>College:</strong> {data.college_name} ({data.college_code})</p>
                 <p><strong>Course:</strong> {data.course} ({data.course_code})</p>

                 <hr/><h3>Theory Subjects</h3>
                 {data.theorySubjects?.length > 0 ? (
                    <table className={styles.modalTable}><thead><tr><th>Code</th><th>Name</th><th>ESE</th><th>IA</th><th>Total</th><th>Grade</th><th>Credit</th></tr></thead><tbody>
                    {data.theorySubjects.map(s => <tr key={s.code}><td>{s.code}</td><td>{s.name}</td><td>{s.ese??'-'}</td><td>{s.ia??'-'}</td><td>{s.total??'-'}</td><td>{s.grade??'-'}</td><td>{s.credit??'-'}</td></tr>)}</tbody></table>
                 ) : <p>No theory subjects found.</p>}

                 <hr/><h3>Practical Subjects</h3>
                 {data.practicalSubjects?.length > 0 ? (
                    <table className={styles.modalTable}><thead><tr><th>Code</th><th>Name</th><th>ESE</th><th>IA</th><th>Total</th><th>Grade</th><th>Credit</th></tr></thead><tbody>
                    {data.practicalSubjects.map(s => <tr key={s.code}><td>{s.code}</td><td>{s.name}</td><td>{s.ese??'-'}</td><td>{s.ia??'-'}</td><td>{s.total??'-'}</td><td>{s.grade??'-'}</td><td>{s.credit??'-'}</td></tr>)}</tbody></table>
                  ): <p>No practical subjects found.</p>}
                 
                 <hr/><div style={{marginTop: '15px'}}>
                  <p><strong>SGPA (Current Sem):</strong> {data.sgpa?.[getArabicSemester(data.semester) - 1] ?? 'N/A'}</p>
                  <p><strong>CGPA:</strong> {data.cgpa || 'N/A'}</p>
                  <p><strong>Status:</strong> <span className={data.fail_any?.includes('PASS') ? styles.passStatus : styles.failStatus}>{data.fail_any || 'N/A'}</span></p>
                 </div>

                {data.sgpa?.some(s => s !== null) && ( <> <hr/><h3 style={{marginTop: '15px'}}>SGPA History</h3> <table className={styles.modalTable}><thead><tr><th>I</th><th>II</th><th>III</th><th>IV</th><th>V</th><th>VI</th><th>VII</th><th>VIII</th></tr></thead><tbody><tr>{Array.from({ length: 8 }).map((_, i) => <td key={i} style={{textAlign:'center'}}>{data.sgpa[i] ?? 'NA'}</td>)}</tr></tbody></table></> )}
                
                {data.fail_any && data.fail_any !== 'PASS' && ( 
                    <> 
                        <hr/> <h3 style={{marginTop: '15px'}} className={styles.failStatus}>Remarks: {data.fail_any.split(':')[0]}</h3>
                        <ul style={{color: '#dc3545', fontSize: '0.9em', paddingLeft: '20px', margin: '5px 0'}}>
                            {data.fail_any.replace("FAIL:", "").replace(/\s/g, "").split(',').map(code => code.trim()).map(code => {
                                if(!code) return null;
                                const subject = allSubjects.find(s => s.code === code);
                                return subject ? <li key={code}>{subject.name} ({subject.code})</li> : <li key={code}>{code}</li>;
                            })}
                        </ul>
                    </> 
                )}
                 {examDetails?.publishDate && (
                     <p style={{fontSize: '0.9em', color: '#6c757d', marginTop: '15px', borderTop: '1px solid #eee', paddingTop: '10px'}}>
                         Publish Date: {new Date(examDetails.publishDate).toLocaleDateString()}
                     </p>
                 )}
             </div>
         );
     };


    // --- JSX ---
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
                    {searchPerformed && !isLoading && !isLoadingMore && (classResults.length > 0) && (
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
                    {/* Show progress bar only *after* user fetch is done and we start lazy loading */}
                    {searchPerformed && !isLoading && progress.total > 0 && (
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

            {/* --- User Result Display (DETAILED) --- */}
            {userResult && (
                 <div className={`${styles.userResultBox} ${styles[userResult.status?.replace(/\s+/g, '')?.toLowerCase() || 'unknown']}`}>
                    <h2>Your Result</h2>
                    <DetailedResultView studentResult={userResult} />
                </div>
            )}

             {/* --- Load More Button / Progress Info --- */}
             {searchPerformed && !isLoading && showLoadMore && !isLoadingMore && !fetchedReg2 && (
                 <div className={styles.loadMoreContainer}>
                    <p>Showing results for 1-60 & LE students. Click below to load the remaining results for potentially larger colleges (61-120).</p>
                    <button onClick={fetchReg2Results} className={`${styles.button} ${styles.buttonSecondary}`}>
                        Load More Results (61-120)
                    </button>
                 </div>
             )}
             {searchPerformed && !isLoading && !isLoadingMore && fetchedReg2 && <div className={styles.progressInfo}>All available results (1-120 & LE) loaded.</div>}

            {/* --- Class Results Table --- */}
             {searchPerformed && (classResults.length > 0 || (isLoading || isLoadingMore)) && (
                <h2 className={styles.tableTitle}>{loadingStage ? loadingStage : 'Class Results (Excluding "Not Found")'}</h2>
             )}
            {searchPerformed && classResults.length > 0 && (
                <div className={styles.tableContainer}>
                    <table className={styles.resultsTable}>
                        <thead> <tr> <th>Reg No</th> <th>Name</th> <th>SGPA</th> <th>CGPA</th> <th>Status</th> <th>Details / Reason</th> </tr> </thead>
                        <tbody>
                            {classResults
                               .filter(result => result.regNo !== userResult?.regNo) // Filter out user row
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
            
            {/* --- Error List Box --- */}
            {searchPerformed && !isLoading && !isLoadingMore && errorList.length > 0 && (
                 <div className={`${styles.errorBox} ${styles.errorListBox}`}>
                    <p>The following registration numbers encountered temporary errors (e.g., Timeout) and were not loaded:</p>
                    <ul style={{fontSize: '0.9em', listStyle: 'none', paddingLeft: '10px', columns: 3, columnGap: '10px'}}>
                         {[...new Set(errorList)].map(reg => <li key={reg}>- {reg}</li>)} {/* Ensure unique */}
                    </ul>
                     <p style={{marginTop: '10px', fontStyle: 'italic'}}>Click "Re-Check Failed" to try fetching these (and other failed ranges) again.</p>
                 </div>
            )}

            {/* No results message */}
            {searchPerformed && !isLoading && !userResult && classResults.length === 0 && !error && <p className={styles.noResults}>No results found or loaded yet for the class.</p>}

             {/* --- Modal for Full Details (Used for Class Results) --- */}
             {modalOpen && selectedStudentData && (
                <div className={styles.modalBackdrop} onClick={closeModal}>
                    <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
                         <button className={styles.modalCloseButton} onClick={closeModal}>&times;</button>
                        {/* Re-use the detailed view component */}
                        <DetailedResultView studentResult={{data: selectedStudentData, status: 'success', regNo: selectedStudentData.redg_no}} /> 
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultFinder;
