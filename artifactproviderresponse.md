
{id: 'pr-session-1772071684912-5jrs45-ai-1772071684912-cmnexq-qwen-mapping-1-1772147062880', sessionId: 'session-1772071684912-5jrs45', aiTurnId: 'ai-1772071684912-cmnexq', providerId: 'qwen', responseType: 'mapping', …}
aiTurnId
: 
"ai-1772071684912-cmnexq"
artifact
: 
blastRadiusFilter
: 
axes
: 
Array(2)
0
: 
claimIds
: 
Array(1)
0
: 
"claim_2"
length
: 
1
id
: 
"axis_0"
maxBlastRadius
: 
0.20416666666666666
representativeClaimId
: 
"claim_2"
1
: 
claimIds
: 
Array(1)
0
: 
"claim_6"
length
: 
1
id
: 
"axis_1"
maxBlastRadius
: 
0.20341419586702605
representativeClaimId
: 
"claim_6"
length
: 
2
meta
: 
axisCount
: 
2
candidateCount
: 
2
conflictEdgeCount
: 
3
convergenceRatio
: 
0.3
processingTimeMs
: 
0.30000001192092896
suppressedCount
: 
8
totalClaims
: 
10
questionCeiling
: 
2
scores
: 
Array(10)
0
: 
claimId
: 
"claim_1"
claimLabel
: 
"Prioritize user attention by surfacing only high-consequence decisions"
components
: 
articulationPoint
: 
1
cascadeBreadth
: 
0
exclusiveEvidence
: 
0.25
leverage
: 
0.31603773584905664
queryRelevance
: 
0
composite
: 
0.15035377358490565
rawComposite
: 
0.3007075471698113
suppressed
: 
true
suppressionReason
: 
"below_floor(0.150): consensus: ×0.50 (support=1.00, models=5)"
1
: 
{claimId: 'claim_2', claimLabel: 'Default to preservation over deletion when pruning content', composite: 0.20416666666666666, rawComposite: 0.4083333333333333, components: {…}, …}
2
: 
{claimId: 'claim_3', claimLabel: 'Acknowledge that geometric proximity cannot distinguish semantic opposition', composite: 0.08053887935963408, rawComposite: 0.16107775871926816, components: {…}, …}
3
: 
{claimId: 'claim_4', claimLabel: 'Trust the Mapper as the sole authority on meaning despite its fallibility', composite: 0.10575471698113206, rawComposite: 0.17625786163522011, components: {…}, …}
4
: 
{claimId: 'claim_5', claimLabel: 'Limit user-facing questions to 1–3 even when more high-blast-radius claims exist', composite: 0.07620283018867924, rawComposite: 0.16933962264150942, components: {…}, …}
5
: 
{claimId: 'claim_6', claimLabel: 'Skeletonized content risks incoherent synthesis without robust final LLM handling', composite: 0.20341419586702605, rawComposite: 0.25426774483378256, components: {…}, …}
6
: 
{claimId: 'claim_7', claimLabel: 'Consensus hallucination may pass undetected due to geometric reinforcement', composite: 0.07620283018867924, rawComposite: 0.16933962264150942, components: {…}, …}
7
: 
{claimId: 'claim_8', claimLabel: 'Latency from six-model orchestration makes this unsuitable for real-time chat', composite: 0.08534107402031932, rawComposite: 0.10667634252539913, components: {…}, …}
8
: 
{claimId: 'claim_9', claimLabel: 'Diagnostic outputs enable collaborative sensemaking beyond answer generation', composite: 0.04673076923076923, rawComposite: 0.10384615384615384, components: {…}, …}
9
: 
{claimId: 'claim_10', claimLabel: 'User misunderstanding of a question can permanently corrupt output without undo', composite: 0.08113207547169812, rawComposite: 0.10141509433962265, components: {…}, …}
length
: 
10
skipReason
: 
null
skipSurvey
: 
false
claimProvenance
: 
claimExclusivity
: 
claim_1
: 
exclusiveIds
: 
Array(3)
0
: 
"s_0"
1
: 
"s_1"
2
: 
"s_2"
length
: 
3
exclusivityRatio
: 
0.25
sharedIds
: 
(9) ['s_49', 's_50', 's_51', 's_85', 's_86', 's_87', 's_88', 's_95', 's_96']
claim_2
: 
{exclusiveIds: Array(0), sharedIds: Array(9), exclusivityRatio: 0}
claim_3
: 
{exclusiveIds: Array(8), sharedIds: Array(25), exclusivityRatio: 0.24242424242424243}
claim_4
: 
{exclusiveIds: Array(6), sharedIds: Array(12), exclusivityRatio: 0.3333333333333333}
claim_5
: 
{exclusiveIds: Array(0), sharedIds: Array(2), exclusivityRatio: 0}
claim_6
: 
{exclusiveIds: Array(13), sharedIds: Array(29), exclusivityRatio: 0.30952380952380953}
claim_7
: 
{exclusiveIds: Array(0), sharedIds: Array(8), exclusivityRatio: 0}
claim_8
: 
{exclusiveIds: Array(3), sharedIds: Array(23), exclusivityRatio: 0.11538461538461539}
claim_9
: 
{exclusiveIds: Array(3), sharedIds: Array(23), exclusivityRatio: 0.11538461538461539}
claim_10
: 
{exclusiveIds: Array(0), sharedIds: Array(4), exclusivityRatio: 0}
claimOverlap
: 
Array(18)
0
: 
claimA
: 
"claim_8"
claimB
: 
"claim_9"
jaccard
: 
0.4444444444444444
1
: 
{claimA: 'claim_2', claimB: 'claim_7', jaccard: 0.4166666666666667}
2
: 
{claimA: 'claim_3', claimB: 'claim_4', jaccard: 0.3076923076923077}
3
: 
{claimA: 'claim_1', claimB: 'claim_2', jaccard: 0.23529411764705882}
4
: 
{claimA: 'claim_6', claimB: 'claim_8', jaccard: 0.1724137931034483}
5
: 
{claimA: 'claim_6', claimB: 'claim_9', jaccard: 0.1724137931034483}
6
: 
{claimA: 'claim_1', claimB: 'claim_5', jaccard: 0.16666666666666666}
7
: 
{claimA: 'claim_2', claimB: 'claim_6', jaccard: 0.1590909090909091}
8
: 
{claimA: 'claim_1', claimB: 'claim_3', jaccard: 0.125}
9
: 
{claimA: 'claim_1', claimB: 'claim_6', jaccard: 0.08}
10
: 
{claimA: 'claim_3', claimB: 'claim_6', jaccard: 0.07142857142857142}
11
: 
{claimA: 'claim_8', claimB: 'claim_10', jaccard: 0.07142857142857142}
12
: 
{claimA: 'claim_6', claimB: 'claim_7', jaccard: 0.06382978723404255}
13
: 
{claimA: 'claim_3', claimB: 'claim_5', jaccard: 0.06060606060606061}
14
: 
{claimA: 'claim_3', claimB: 'claim_7', jaccard: 0.05128205128205128}
15
: 
{claimA: 'claim_6', claimB: 'claim_10', jaccard: 0.045454545454545456}
16
: 
{claimA: 'claim_7', claimB: 'claim_9', jaccard: 0.030303030303030304}
17
: 
{claimA: 'claim_3', claimB: 'claim_9', jaccard: 0.017241379310344827}
length
: 
18
elbowDiagnostics
: 
claim_1
: 
cv
: 
1.4917451730300553
elbowPosition
: 
0
exclusionElbow
: 
0
maxGap
: 
0.04607992405146866
maxGapSigma
: 
4.088342515033005
meanGap
: 
0.0075556153493281705
poolSize
: 
37
stddevGap
: 
0.011271052726632093
totalRange
: 
0.2795577679251423
totalSources
: 
38
claim_2
: 
{totalSources: 38, meanGap: 0.008146705196289131, stddevGap: 0.010167052363973356, maxGap: 0.0378684942506361, elbowPosition: 5, …}
claim_3
: 
{totalSources: 38, meanGap: 0.007164808155736316, stddevGap: 0.007971107546744594, maxGap: 0.04060395081511248, elbowPosition: 2, …}
claim_4
: 
{totalSources: 38, meanGap: 0.006286002649256816, stddevGap: 0.0067140081632098385, maxGap: 0.02628899032795906, elbowPosition: 2, …}
claim_5
: 
{totalSources: 38, meanGap: 0.007065916451659811, stddevGap: 0.010063069590405913, maxGap: 0.05336450784020397, elbowPosition: 35, …}
claim_6
: 
{totalSources: 38, meanGap: 0.006916983190296523, stddevGap: 0.008325276755312682, maxGap: 0.03581320188933246, elbowPosition: 5, …}
claim_7
: 
{totalSources: 38, meanGap: 0.006086281848051267, stddevGap: 0.007779319129444508, maxGap: 0.03804339963758041, elbowPosition: 22, …}
claim_8
: 
{totalSources: 38, meanGap: 0.006740614834687233, stddevGap: 0.01001561511127683, maxGap: 0.04922382719801066, elbowPosition: 0, …}
claim_9
: 
{totalSources: 38, meanGap: 0.0041073643855130985, stddevGap: 0.004676063568755804, maxGap: 0.021821788604426184, elbowPosition: 0, …}
claim_10
: 
{totalSources: 38, meanGap: 0.006955168987828337, stddevGap: 0.009497267829502058, maxGap: 0.04952014933853888, elbowPosition: 0, …}
statementOwnership
: 
s_0
: 
Array(1)
0
: 
"claim_1"
length
: 
1
s_1
: 
['claim_1']
s_2
: 
['claim_1']
s_3
: 
(3) ['claim_2', 'claim_6', 'claim_7']
s_4
: 
(3) ['claim_2', 'claim_6', 'claim_7']
s_5
: 
(3) ['claim_2', 'claim_6', 'claim_7']
s_6
: 
(2) ['claim_3', 'claim_4']
s_7
: 
(2) ['claim_3', 'claim_4']
s_8
: 
['claim_4']
s_9
: 
['claim_4']
s_10
: 
['claim_4']
s_11
: 
(2) ['claim_6', 'claim_9']
s_12
: 
(2) ['claim_3', 'claim_6']
s_13
: 
(2) ['claim_3', 'claim_6']
s_14
: 
(2) ['claim_3', 'claim_6']
s_15
: 
(2) ['claim_3', 'claim_6']
s_16
: 
(2) ['claim_3', 'claim_7']
s_17
: 
(2) ['claim_3', 'claim_7']
s_19
: 
['claim_6']
s_20
: 
['claim_6']
s_21
: 
['claim_6']
s_22
: 
['claim_6']
s_23
: 
['claim_6']
s_24
: 
['claim_6']
s_25
: 
['claim_6']
s_26
: 
['claim_6']
s_27
: 
['claim_6']
s_28
: 
['claim_6']
s_29
: 
['claim_6']
s_30
: 
(2) ['claim_2', 'claim_7']
s_31
: 
(2) ['claim_2', 'claim_7']
s_32
: 
(2) ['claim_3', 'claim_4']
s_33
: 
(2) ['claim_3', 'claim_4']
s_34
: 
(2) ['claim_3', 'claim_4']
s_35
: 
(2) ['claim_3', 'claim_4']
s_36
: 
(2) ['claim_6', 'claim_8']
s_37
: 
(2) ['claim_6', 'claim_8']
s_38
: 
['claim_8']
s_39
: 
['claim_8']
s_40
: 
(2) ['claim_6', 'claim_9']
s_41
: 
(2) ['claim_6', 'claim_9']
s_42
: 
(2) ['claim_6', 'claim_9']
s_43
: 
(2) ['claim_6', 'claim_9']
s_44
: 
(3) ['claim_6', 'claim_8', 'claim_9']
s_45
: 
(3) ['claim_6', 'claim_8', 'claim_9']
s_46
: 
(3) ['claim_6', 'claim_8', 'claim_9']
s_47
: 
(3) ['claim_6', 'claim_8', 'claim_9']
s_48
: 
(3) ['claim_6', 'claim_8', 'claim_9']
s_49
: 
(2) ['claim_1', 'claim_3']
s_50
: 
(2) ['claim_1', 'claim_3']
s_51
: 
(2) ['claim_1', 'claim_3']
s_52
: 
['claim_3']
s_53
: 
['claim_3']
s_54
: 
(2) ['claim_6', 'claim_8']
s_55
: 
(2) ['claim_6', 'claim_8']
s_56
: 
(2) ['claim_6', 'claim_8']
s_57
: 
['claim_8']
s_58
: 
(2) ['claim_8', 'claim_9']
s_59
: 
(2) ['claim_8', 'claim_9']
s_60
: 
(2) ['claim_8', 'claim_9']
s_61
: 
(2) ['claim_8', 'claim_9']
s_62
: 
(2) ['claim_8', 'claim_9']
s_63
: 
(2) ['claim_8', 'claim_9']
s_64
: 
(2) ['claim_8', 'claim_9']
s_65
: 
(2) ['claim_8', 'claim_9']
s_66
: 
['claim_3']
s_67
: 
['claim_3']
s_68
: 
['claim_3']
s_69
: 
['claim_3']
s_70
: 
(2) ['claim_3', 'claim_6']
s_71
: 
(2) ['claim_3', 'claim_4']
s_72
: 
(2) ['claim_3', 'claim_4']
s_73
: 
(2) ['claim_3', 'claim_4']
s_74
: 
(2) ['claim_3', 'claim_4']
s_75
: 
(2) ['claim_3', 'claim_4']
s_76
: 
(2) ['claim_3', 'claim_4']
s_77
: 
['claim_3']
s_78
: 
['claim_3']
s_79
: 
['claim_9']
s_80
: 
['claim_9']
s_81
: 
(2) ['claim_8', 'claim_9']
s_82
: 
(2) ['claim_8', 'claim_9']
s_83
: 
(2) ['claim_8', 'claim_10']
s_84
: 
(2) ['claim_8', 'claim_10']
s_85
: 
(3) ['claim_1', 'claim_2', 'claim_6']
s_86
: 
(3) ['claim_1', 'claim_2', 'claim_6']
s_87
: 
(3) ['claim_1', 'claim_2', 'claim_6']
s_88
: 
(3) ['claim_1', 'claim_2', 'claim_6']
s_89
: 
(2) ['claim_7', 'claim_9']
s_90
: 
['claim_4']
s_91
: 
['claim_4']
s_92
: 
['claim_4']
s_93
: 
['claim_6']
s_94
: 
['claim_6']
s_95
: 
(3) ['claim_1', 'claim_3', 'claim_5']
s_96
: 
(3) ['claim_1', 'claim_3', 'claim_5']
s_97
: 
['claim_9']
s_98
: 
(2) ['claim_6', 'claim_10']
s_99
: 
(2) ['claim_6', 'claim_10']
s_100
: 
(2) ['claim_8', 'claim_9']
s_101
: 
(2) ['claim_3', 'claim_9']
completeness
: 
report
: 
recovery
: 
unaddressedStatements
: 
Array(0)
length
: 
0
unattendedRegionPreviews
: 
[]
regions
: 
attended
: 
10
coverageRatio
: 
1
total
: 
10
unattended
: 
0
statements
: 
coverageRatio
: 
0.9901960784313726
inClaims
: 
101
noise
: 
0
orphaned
: 
1
total
: 
102
unaddressed
: 
0
statementFates
: 
s_0
: 
{statementId: 's_0', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_1', …}
s_1
: 
{statementId: 's_1', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_1', …}
s_2
: 
{statementId: 's_2', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_1', …}
s_3
: 
{statementId: 's_3', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_2, claim_6, claim_7', …}
s_4
: 
{statementId: 's_4', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_2, claim_6, claim_7', …}
s_5
: 
{statementId: 's_5', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_2, claim_6, claim_7', …}
s_6
: 
{statementId: 's_6', regionId: 'r_4', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_7
: 
{statementId: 's_7', regionId: 'r_4', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_8
: 
{statementId: 's_8', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_4', …}
s_9
: 
{statementId: 's_9', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_4', …}
s_10
: 
{statementId: 's_10', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_4', …}
s_11
: 
{statementId: 's_11', regionId: 'r_9', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_9', …}
s_12
: 
{statementId: 's_12', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_6', …}
s_13
: 
{statementId: 's_13', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_6', …}
s_14
: 
{statementId: 's_14', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_6', …}
s_15
: 
{statementId: 's_15', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_6', …}
s_16
: 
{statementId: 's_16', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_7', …}
s_17
: 
{statementId: 's_17', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_7', …}
s_18
: 
{statementId: 's_18', regionId: 'r_2', claimIds: Array(0), fate: 'orphan', reason: 'In region r_2 but not referenced by any claim', …}
s_19
: 
{statementId: 's_19', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_20
: 
{statementId: 's_20', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_21
: 
{statementId: 's_21', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_22
: 
{statementId: 's_22', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_23
: 
{statementId: 's_23', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_24
: 
{statementId: 's_24', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_25
: 
{statementId: 's_25', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_26
: 
{statementId: 's_26', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_27
: 
{statementId: 's_27', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_28
: 
{statementId: 's_28', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_29
: 
{statementId: 's_29', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_30
: 
{statementId: 's_30', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_2, claim_7', …}
s_31
: 
{statementId: 's_31', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_2, claim_7', …}
s_32
: 
{statementId: 's_32', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_33
: 
{statementId: 's_33', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_34
: 
{statementId: 's_34', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_35
: 
{statementId: 's_35', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_36
: 
{statementId: 's_36', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_8', …}
s_37
: 
{statementId: 's_37', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_8', …}
s_38
: 
{statementId: 's_38', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_8', …}
s_39
: 
{statementId: 's_39', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_8', …}
s_40
: 
{statementId: 's_40', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_9', …}
s_41
: 
{statementId: 's_41', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_9', …}
s_42
: 
{statementId: 's_42', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_9', …}
s_43
: 
{statementId: 's_43', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_9', …}
s_44
: 
{statementId: 's_44', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_6, claim_8, claim_9', …}
s_45
: 
{statementId: 's_45', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_6, claim_8, claim_9', …}
s_46
: 
{statementId: 's_46', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_6, claim_8, claim_9', …}
s_47
: 
{statementId: 's_47', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_6, claim_8, claim_9', …}
s_48
: 
{statementId: 's_48', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_6, claim_8, claim_9', …}
s_49
: 
{statementId: 's_49', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_1, claim_3', …}
s_50
: 
{statementId: 's_50', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_1, claim_3', …}
s_51
: 
{statementId: 's_51', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_1, claim_3', …}
s_52
: 
{statementId: 's_52', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_53
: 
{statementId: 's_53', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_54
: 
{statementId: 's_54', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_8', …}
s_55
: 
{statementId: 's_55', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_8', …}
s_56
: 
{statementId: 's_56', regionId: 'r_3', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_8', …}
s_57
: 
{statementId: 's_57', regionId: 'r_2', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_8', …}
s_58
: 
{statementId: 's_58', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_59
: 
{statementId: 's_59', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_60
: 
{statementId: 's_60', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_61
: 
{statementId: 's_61', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_62
: 
{statementId: 's_62', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_63
: 
{statementId: 's_63', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_64
: 
{statementId: 's_64', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_65
: 
{statementId: 's_65', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_66
: 
{statementId: 's_66', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_67
: 
{statementId: 's_67', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_68
: 
{statementId: 's_68', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_69
: 
{statementId: 's_69', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_70
: 
{statementId: 's_70', regionId: 'r_5', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_6', …}
s_71
: 
{statementId: 's_71', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_72
: 
{statementId: 's_72', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_73
: 
{statementId: 's_73', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_74
: 
{statementId: 's_74', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_75
: 
{statementId: 's_75', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_76
: 
{statementId: 's_76', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_4', …}
s_77
: 
{statementId: 's_77', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_78
: 
{statementId: 's_78', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_3', …}
s_79
: 
{statementId: 's_79', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_9', …}
s_80
: 
{statementId: 's_80', regionId: 'r_0', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_9', …}
s_81
: 
{statementId: 's_81', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_82
: 
{statementId: 's_82', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_83
: 
{statementId: 's_83', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_10', …}
s_84
: 
{statementId: 's_84', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_10', …}
s_85
: 
{statementId: 's_85', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_1, claim_2, claim_6', …}
s_86
: 
{statementId: 's_86', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_1, claim_2, claim_6', …}
s_87
: 
{statementId: 's_87', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_1, claim_2, claim_6', …}
s_88
: 
{statementId: 's_88', regionId: 'r_0', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_1, claim_2, claim_6', …}
s_89
: 
{statementId: 's_89', regionId: 'r_1', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_7, claim_9', …}
s_90
: 
{statementId: 's_90', regionId: 'r_6', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_4', …}
s_91
: 
{statementId: 's_91', regionId: 'r_6', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_4', …}
s_92
: 
{statementId: 's_92', regionId: 'r_6', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_4', …}
s_93
: 
{statementId: 's_93', regionId: 'r_7', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_94
: 
{statementId: 's_94', regionId: 'r_7', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_6', …}
s_95
: 
{statementId: 's_95', regionId: 'r_8', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_1, claim_3, claim_5', …}
s_96
: 
{statementId: 's_96', regionId: 'r_8', claimIds: Array(3), fate: 'supporting', reason: 'Referenced by 3 claim(s): claim_1, claim_3, claim_5', …}
s_97
: 
{statementId: 's_97', regionId: 'r_1', claimIds: Array(1), fate: 'primary', reason: 'Referenced by 1 claim(s): claim_9', …}
s_98
: 
{statementId: 's_98', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_10', …}
s_99
: 
{statementId: 's_99', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_6, claim_10', …}
s_100
: 
{statementId: 's_100', regionId: 'r_0', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_8, claim_9', …}
s_101
: 
{statementId: 's_101', regionId: 'r_1', claimIds: Array(2), fate: 'supporting', reason: 'Referenced by 2 claim(s): claim_3, claim_9', …}
unattendedRegions
: 
Array(0)
length
: 
0
geometry
: 
basinInversion
: 
{status: 'no_basin_structure', statusLabel: 'Continuous Field / No Basin Structure Detected', nodeCount: 38, pairCount: 703, mu: 0.6787769519633065, …}
embeddingStatus
: 
"computed"
preSemantic
: 
lens
: 
confidence
: 
0.7605263157894737
evidence
: 
(6) ['shape.conf=0.68', 'shape.frag=0.40,bim=0.09,par=0.00,conv=0.68', 'mr_density=0.075', 'isolation=0.184', 'p95=0.838', 'discrimination=0.156']
hardMergeThreshold
: 
0.808226
k
: 
5
softThreshold
: 
0.78
modelOrdering
: 
meta
: 
adaptiveAlphaFraction
: 
0.015291556599078868
processingTimeMs
: 
0
queryRelevanceVariance
: 
0.00023383170322283244
regionCount
: 
10
totalModels
: 
5
orderedModelIndices
: 
Array(5)
0
: 
5
1
: 
1
2
: 
3
3
: 
2
4
: 
4
length
: 
5
scores
: 
Array(5)
0
: 
breakdown
: 
{soloCarrierRegions: 4, lowDiversityContribution: 4, totalParagraphsInRegions: 12}
irreplaceability
: 
4.105979795200679
modelIndex
: 
5
queryRelevanceBoost
: 
0.6036562432709777
1
: 
{modelIndex: 4, irreplaceability: 2.347780425603077, breakdown: {…}, queryRelevanceBoost: 0.5985398834015123}
2
: 
{modelIndex: 1, irreplaceability: 2.0886165725805665, breakdown: {…}, queryRelevanceBoost: 0.5836916855879235}
3
: 
{modelIndex: 2, irreplaceability: 0.353878185047816, breakdown: {…}, queryRelevanceBoost: 0.5824505606213886}
4
: 
{modelIndex: 3, irreplaceability: 0.10033352900858064, breakdown: {…}, queryRelevanceBoost: 0.6243012266815344}
length
: 
5
pipelineGate
: 
confidence
: 
0.6188613425455531
evidence
: 
Array(6)
0
: 
"mutual_recognition_edges=53"
1
: 
"discrimination_range=0.156"
2
: 
"participation_rate=82%"
3
: 
"largest_component=68%_of_nodes"
4
: 
"model_diversity_in_largest=5/5"
5
: 
"isolation_ratio=18%"
length
: 
6
measurements
: 
isDegenerate
: 
false
isolationRatio
: 
0.18421052631578946
largestComponentModelDiversityRatio
: 
1
largestComponentRatio
: 
0.6842105263157895
maxComponentSize
: 
26
nodeCount
: 
38
participationRate
: 
0.8157894736842105
verdict
: 
"proceed"
regionProfiles
: 
Array(10)
0
: 
geometry
: 
avgInternalSimilarity
: 
0.7934698400000002
internalDensity
: 
0.15384615384615385
isolation
: 
0.18331061538461538
nearestCarrierSimilarity
: 
0.8406947912065539
mass
: 
modelDiversity
: 
5
modelDiversityRatio
: 
1
nodeCount
: 
26
regionId
: 
"r_0"
1
: 
{regionId: 'r_1', mass: {…}, geometry: {…}}
2
: 
{regionId: 'r_2', mass: {…}, geometry: {…}}
3
: 
{regionId: 'r_3', mass: {…}, geometry: {…}}
4
: 
{regionId: 'r_4', mass: {…}, geometry: {…}}
5
: 
{regionId: 'r_5', mass: {…}, geometry: {…}}
6
: 
{regionId: 'r_6', mass: {…}, geometry: {…}}
7
: 
{regionId: 'r_7', mass: {…}, geometry: {…}}
8
: 
{regionId: 'r_8', mass: {…}, geometry: {…}}
9
: 
{regionId: 'r_9', mass: {…}, geometry: {…}}
length
: 
10
regionization
: 
meta
: 
coveredNodes
: 
38
kindCounts
: 
component
: 
3
patch
: 
7
regionCount
: 
10
totalNodes
: 
38
regions
: 
Array(10)
0
: 
id
: 
"r_0"
kind
: 
"component"
modelIndices
: 
(5) [1, 2, 3, 4, 5]
nodeIds
: 
(26) ['p_0', 'p_1', 'p_10', 'p_11', 'p_12', 'p_13', 'p_14', 'p_15', 'p_16', 'p_17', 'p_18', 'p_21', 'p_22', 'p_24', 'p_25', 'p_26', 'p_27', 'p_28', 'p_29', 'p_3', 'p_35', 'p_36', 'p_5', 'p_6', 'p_8', 'p_9']
sourceId
: 
"comp_0"
statementIds
: 
(85) ['s_0', 's_1', 's_2', 's_3', 's_4', 's_5', 's_30', 's_31', 's_32', 's_33', 's_34', 's_35', 's_36', 's_37', 's_38', 's_39', 's_40', 's_41', 's_42', 's_43', 's_44', 's_45', 's_46', 's_47', 's_48', 's_49', 's_50', 's_51', 's_52', 's_53', 's_54', 's_55', 's_58', 's_59', 's_60', 's_61', 's_62', 's_63', 's_64', 's_65', 's_66', 's_67', 's_68', 's_69', 's_71', 's_72', 's_73', 's_74', 's_75', 's_76', 's_77', 's_78', 's_79', 's_80', 's_81', 's_82', 's_83', 's_84', 's_85', 's_86', 's_87', 's_88', 's_8', 's_9', 's_10', 's_98', 's_99', 's_100', 's_12', 's_13', 's_14', 's_15', 's_16', 's_17', 's_19', 's_20', 's_21', 's_22', 's_23', 's_24', 's_25', 's_26', 's_27', 's_28', 's_29']
1
: 
{id: 'r_1', kind: 'component', nodeIds: Array(3), statementIds: Array(3), sourceId: 'comp_1', …}
2
: 
{id: 'r_2', kind: 'component', nodeIds: Array(2), statementIds: Array(2), sourceId: 'comp_2', …}
3
: 
{id: 'r_3', kind: 'patch', nodeIds: Array(1), statementIds: Array(1), sourceId: 'patch_p_19', …}
4
: 
{id: 'r_4', kind: 'patch', nodeIds: Array(1), statementIds: Array(2), sourceId: 'patch_p_2', …}
5
: 
{id: 'r_5', kind: 'patch', nodeIds: Array(1), statementIds: Array(1), sourceId: 'patch_p_23', …}
6
: 
{id: 'r_6', kind: 'patch', nodeIds: Array(1), statementIds: Array(3), sourceId: 'patch_p_31', …}
7
: 
{id: 'r_7', kind: 'patch', nodeIds: Array(1), statementIds: Array(2), sourceId: 'patch_p_32', …}
8
: 
{id: 'r_8', kind: 'patch', nodeIds: Array(1), statementIds: Array(2), sourceId: 'patch_p_33', …}
9
: 
{id: 'r_9', kind: 'patch', nodeIds: Array(1), statementIds: Array(1), sourceId: 'patch_p_4', …}
length
: 
10
regions
: 
Array(10)
0
: 
id
: 
"r_0"
kind
: 
"component"
nodeIds
: 
Array(26)
0
: 
"p_0"
1
: 
"p_1"
2
: 
"p_10"
3
: 
"p_11"
4
: 
"p_12"
5
: 
"p_13"
6
: 
"p_14"
7
: 
"p_15"
8
: 
"p_16"
9
: 
"p_17"
10
: 
"p_18"
11
: 
"p_21"
12
: 
"p_22"
13
: 
"p_24"
14
: 
"p_25"
15
: 
"p_26"
16
: 
"p_27"
17
: 
"p_28"
18
: 
"p_29"
19
: 
"p_3"
20
: 
"p_35"
21
: 
"p_36"
22
: 
"p_5"
23
: 
"p_6"
24
: 
"p_8"
25
: 
"p_9"
length
: 
26
1
: 
{id: 'r_1', kind: 'component', nodeIds: Array(3)}
2
: 
{id: 'r_2', kind: 'component', nodeIds: Array(2)}
3
: 
{id: 'r_3', kind: 'patch', nodeIds: Array(1)}
4
: 
{id: 'r_4', kind: 'patch', nodeIds: Array(1)}
5
: 
{id: 'r_5', kind: 'patch', nodeIds: Array(1)}
6
: 
{id: 'r_6', kind: 'patch', nodeIds: Array(1)}
7
: 
{id: 'r_7', kind: 'patch', nodeIds: Array(1)}
8
: 
{id: 'r_8', kind: 'patch', nodeIds: Array(1)}
9
: 
{id: 'r_9', kind: 'patch', nodeIds: Array(1)}
length
: 
10
shapeSignals
: 
bimodalityScore
: 
0
confidence
: 
0
convergentScore
: 
0
fragmentationScore
: 
1
parallelScore
: 
0
query
: 
relevance
: 
statementScores
: 
s_0
: 
{querySimilarity: 0.5044554862844275, querySimilarityNormalized: 0.7522277431422137, simRaw: 0.5044554862844275, embeddingSource: 'statement', paragraphSimRaw: 0.7418827951330482, …}
s_1
: 
{querySimilarity: 0.6911836236381558, querySimilarityNormalized: 0.8455918118190779, simRaw: 0.6911836236381558, embeddingSource: 'statement', paragraphSimRaw: 0.7418827951330482, …}
s_2
: 
{querySimilarity: 0.4919450643355145, querySimilarityNormalized: 0.7459725321677573, simRaw: 0.4919450643355145, embeddingSource: 'statement', paragraphSimRaw: 0.7418827951330482, …}
s_3
: 
{querySimilarity: 0.5519085026698605, querySimilarityNormalized: 0.7759542513349302, simRaw: 0.5519085026698605, embeddingSource: 'statement', paragraphSimRaw: 0.6717221976086862, …}
s_4
: 
{querySimilarity: 0.6172835341621998, querySimilarityNormalized: 0.8086417670810999, simRaw: 0.6172835341621998, embeddingSource: 'statement', paragraphSimRaw: 0.6717221976086862, …}
s_5
: 
{querySimilarity: 0.5737558828994475, querySimilarityNormalized: 0.7868779414497238, simRaw: 0.5737558828994475, embeddingSource: 'statement', paragraphSimRaw: 0.6717221976086862, …}
s_6
: 
{querySimilarity: 0.5995646866855766, querySimilarityNormalized: 0.7997823433427883, simRaw: 0.5995646866855766, embeddingSource: 'statement', paragraphSimRaw: 0.6569744330006843, …}
s_7
: 
{querySimilarity: 0.5357532276301494, querySimilarityNormalized: 0.7678766138150748, simRaw: 0.5357532276301494, embeddingSource: 'statement', paragraphSimRaw: 0.6569744330006843, …}
s_8
: 
{querySimilarity: 0.6009756545189194, querySimilarityNormalized: 0.8004878272594598, simRaw: 0.6009756545189194, embeddingSource: 'statement', paragraphSimRaw: 0.699056773522624, …}
s_9
: 
{querySimilarity: 0.6222000234353603, querySimilarityNormalized: 0.8111000117176801, simRaw: 0.6222000234353603, embeddingSource: 'statement', paragraphSimRaw: 0.699056773522624, …}
s_10
: 
{querySimilarity: 0.5859462564834114, querySimilarityNormalized: 0.7929731282417056, simRaw: 0.5859462564834114, embeddingSource: 'statement', paragraphSimRaw: 0.699056773522624, …}
s_11
: 
{querySimilarity: 0.6773650031245348, querySimilarityNormalized: 0.8386825015622674, simRaw: 0.6773650031245348, embeddingSource: 'statement', paragraphSimRaw: 0.6720863719527529, …}
s_12
: 
{querySimilarity: 0.4882658095244891, querySimilarityNormalized: 0.7441329047622446, simRaw: 0.4882658095244891, embeddingSource: 'statement', paragraphSimRaw: 0.7188176227460635, …}
s_13
: 
{querySimilarity: 0.6137179426160406, querySimilarityNormalized: 0.8068589713080203, simRaw: 0.6137179426160406, embeddingSource: 'statement', paragraphSimRaw: 0.7188176227460635, …}
s_14
: 
{querySimilarity: 0.6073227723986816, querySimilarityNormalized: 0.8036613861993408, simRaw: 0.6073227723986816, embeddingSource: 'statement', paragraphSimRaw: 0.7188176227460635, …}
s_15
: 
{querySimilarity: 0.577423499000007, querySimilarityNormalized: 0.7887117495000036, simRaw: 0.577423499000007, embeddingSource: 'statement', paragraphSimRaw: 0.7188176227460635, …}
s_16
: 
{querySimilarity: 0.5845548931562152, querySimilarityNormalized: 0.7922774465781076, simRaw: 0.5845548931562152, embeddingSource: 'statement', paragraphSimRaw: 0.7182085205761283, …}
s_17
: 
{querySimilarity: 0.646234983540729, querySimilarityNormalized: 0.8231174917703645, simRaw: 0.646234983540729, embeddingSource: 'statement', paragraphSimRaw: 0.7182085205761283, …}
s_18
: 
{querySimilarity: 0.566299065723691, querySimilarityNormalized: 0.7831495328618455, simRaw: 0.566299065723691, embeddingSource: 'statement', paragraphSimRaw: 0.5766551619200724, …}
s_19
: 
{querySimilarity: 0.6119802908940217, querySimilarityNormalized: 0.8059901454470109, simRaw: 0.6119802908940217, embeddingSource: 'statement', paragraphSimRaw: 0.7192504052076066, …}
s_20
: 
{querySimilarity: 0.5564711854741738, querySimilarityNormalized: 0.778235592737087, simRaw: 0.5564711854741738, embeddingSource: 'statement', paragraphSimRaw: 0.7192504052076066, …}
s_21
: 
{querySimilarity: 0.5721937660501829, querySimilarityNormalized: 0.7860968830250914, simRaw: 0.5721937660501829, embeddingSource: 'statement', paragraphSimRaw: 0.7192504052076066, …}
s_22
: 
{querySimilarity: 0.6398135731206809, querySimilarityNormalized: 0.8199067865603404, simRaw: 0.6398135731206809, embeddingSource: 'statement', paragraphSimRaw: 0.7192504052076066, …}
s_23
: 
{querySimilarity: 0.5674936483399056, querySimilarityNormalized: 0.7837468241699528, simRaw: 0.5674936483399056, embeddingSource: 'statement', paragraphSimRaw: 0.7192504052076066, …}
s_24
: 
{querySimilarity: 0.5927490883418339, querySimilarityNormalized: 0.7963745441709169, simRaw: 0.5927490883418339, embeddingSource: 'statement', paragraphSimRaw: 0.7192504052076066, …}
s_25
: 
{querySimilarity: 0.5243159798233171, querySimilarityNormalized: 0.7621579899116586, simRaw: 0.5243159798233171, embeddingSource: 'statement', paragraphSimRaw: 0.7288248121967739, …}
s_26
: 
{querySimilarity: 0.7117198563679643, querySimilarityNormalized: 0.8558599281839822, simRaw: 0.7117198563679643, embeddingSource: 'statement', paragraphSimRaw: 0.7288248121967739, …}
s_27
: 
{querySimilarity: 0.5608600482829293, querySimilarityNormalized: 0.7804300241414647, simRaw: 0.5608600482829293, embeddingSource: 'statement', paragraphSimRaw: 0.7288248121967739, …}
s_28
: 
{querySimilarity: 0.576785897375896, querySimilarityNormalized: 0.788392948687948, simRaw: 0.576785897375896, embeddingSource: 'statement', paragraphSimRaw: 0.7288248121967739, …}
s_29
: 
{querySimilarity: 0.5241475531735463, querySimilarityNormalized: 0.7620737765867731, simRaw: 0.5241475531735463, embeddingSource: 'statement', paragraphSimRaw: 0.7288248121967739, …}
s_30
: 
{querySimilarity: 0.5204352413067245, querySimilarityNormalized: 0.7602176206533622, simRaw: 0.5204352413067245, embeddingSource: 'statement', paragraphSimRaw: 0.6310981459677361, …}
s_31
: 
{querySimilarity: 0.5827002613488959, querySimilarityNormalized: 0.7913501306744479, simRaw: 0.5827002613488959, embeddingSource: 'statement', paragraphSimRaw: 0.6310981459677361, …}
s_32
: 
{querySimilarity: 0.7090779606846291, querySimilarityNormalized: 0.8545389803423146, simRaw: 0.7090779606846291, embeddingSource: 'statement', paragraphSimRaw: 0.7139805133232647, …}
s_33
: 
{querySimilarity: 0.5577322923235869, querySimilarityNormalized: 0.7788661461617934, simRaw: 0.5577322923235869, embeddingSource: 'statement', paragraphSimRaw: 0.7139805133232647, …}
s_34
: 
{querySimilarity: 0.561802005097273, querySimilarityNormalized: 0.7809010025486365, simRaw: 0.561802005097273, embeddingSource: 'statement', paragraphSimRaw: 0.7139805133232647, …}
s_35
: 
{querySimilarity: 0.48533394384457046, querySimilarityNormalized: 0.7426669719222853, simRaw: 0.48533394384457046, embeddingSource: 'statement', paragraphSimRaw: 0.7139805133232647, …}
s_36
: 
{querySimilarity: 0.6174969959188223, querySimilarityNormalized: 0.8087484979594112, simRaw: 0.6174969959188223, embeddingSource: 'statement', paragraphSimRaw: 0.7143617830162748, …}
s_37
: 
{querySimilarity: 0.5437138034809558, querySimilarityNormalized: 0.7718569017404779, simRaw: 0.5437138034809558, embeddingSource: 'statement', paragraphSimRaw: 0.7143617830162748, …}
s_38
: 
{querySimilarity: 0.589657539847495, querySimilarityNormalized: 0.7948287699237475, simRaw: 0.589657539847495, embeddingSource: 'statement', paragraphSimRaw: 0.6722318131073084, …}
s_39
: 
{querySimilarity: 0.6097859982518942, querySimilarityNormalized: 0.804892999125947, simRaw: 0.6097859982518942, embeddingSource: 'statement', paragraphSimRaw: 0.6722318131073084, …}
s_40
: 
{querySimilarity: 0.6602338731133074, querySimilarityNormalized: 0.8301169365566536, simRaw: 0.6602338731133074, embeddingSource: 'statement', paragraphSimRaw: 0.7333734160021635, …}
s_41
: 
{querySimilarity: 0.6247599501313587, querySimilarityNormalized: 0.8123799750656793, simRaw: 0.6247599501313587, embeddingSource: 'statement', paragraphSimRaw: 0.7333734160021635, …}
s_42
: 
{querySimilarity: 0.6008825109651132, querySimilarityNormalized: 0.8004412554825566, simRaw: 0.6008825109651132, embeddingSource: 'statement', paragraphSimRaw: 0.7333734160021635, …}
s_43
: 
{querySimilarity: 0.5987706647748801, querySimilarityNormalized: 0.79938533238744, simRaw: 0.5987706647748801, embeddingSource: 'statement', paragraphSimRaw: 0.7333734160021635, …}
s_44
: 
{querySimilarity: 0.6201657940648414, querySimilarityNormalized: 0.8100828970324208, simRaw: 0.6201657940648414, embeddingSource: 'statement', paragraphSimRaw: 0.7705197364181852, …}
s_45
: 
{querySimilarity: 0.6120544775701804, querySimilarityNormalized: 0.8060272387850902, simRaw: 0.6120544775701804, embeddingSource: 'statement', paragraphSimRaw: 0.7705197364181852, …}
s_46
: 
{querySimilarity: 0.7053092092624262, querySimilarityNormalized: 0.8526546046312131, simRaw: 0.7053092092624262, embeddingSource: 'statement', paragraphSimRaw: 0.7705197364181852, …}
s_47
: 
{querySimilarity: 0.5671399222871689, querySimilarityNormalized: 0.7835699611435845, simRaw: 0.5671399222871689, embeddingSource: 'statement', paragraphSimRaw: 0.7705197364181852, …}
s_48
: 
{querySimilarity: 0.5912758780405103, querySimilarityNormalized: 0.7956379390202551, simRaw: 0.5912758780405103, embeddingSource: 'statement', paragraphSimRaw: 0.7705197364181852, …}
s_49
: 
{querySimilarity: 0.6646578864453295, querySimilarityNormalized: 0.8323289432226648, simRaw: 0.6646578864453295, embeddingSource: 'statement', paragraphSimRaw: 0.7327087968738575, …}
s_50
: 
{querySimilarity: 0.6689159140689572, querySimilarityNormalized: 0.8344579570344786, simRaw: 0.6689159140689572, embeddingSource: 'statement', paragraphSimRaw: 0.7327087968738575, …}
s_51
: 
{querySimilarity: 0.6535498009951741, querySimilarityNormalized: 0.8267749004975871, simRaw: 0.6535498009951741, embeddingSource: 'statement', paragraphSimRaw: 0.7327087968738575, …}
s_52
: 
{querySimilarity: 0.5902410052572811, querySimilarityNormalized: 0.7951205026286405, simRaw: 0.5902410052572811, embeddingSource: 'statement', paragraphSimRaw: 0.7115337030979105, …}
s_53
: 
{querySimilarity: 0.6314192018286355, querySimilarityNormalized: 0.8157096009143178, simRaw: 0.6314192018286355, embeddingSource: 'statement', paragraphSimRaw: 0.7115337030979105, …}
s_54
: 
{querySimilarity: 0.5602753036734174, querySimilarityNormalized: 0.7801376518367087, simRaw: 0.5602753036734174, embeddingSource: 'statement', paragraphSimRaw: 0.6579491086102784, …}
s_55
: 
{querySimilarity: 0.6113202761979131, querySimilarityNormalized: 0.8056601380989565, simRaw: 0.6113202761979131, embeddingSource: 'statement', paragraphSimRaw: 0.6579491086102784, …}
s_56
: 
{querySimilarity: 0.5761108978035876, querySimilarityNormalized: 0.7880554489017938, simRaw: 0.5761108978035876, embeddingSource: 'statement', paragraphSimRaw: 0.5731194735545564, …}
s_57
: 
{querySimilarity: 0.5776495399770789, querySimilarityNormalized: 0.7888247699885395, simRaw: 0.5776495399770789, embeddingSource: 'statement', paragraphSimRaw: 0.5966771404067666, …}
s_58
: 
{querySimilarity: 0.6977073266363599, querySimilarityNormalized: 0.84885366331818, simRaw: 0.6977073266363599, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_59
: 
{querySimilarity: 0.5766071206956634, querySimilarityNormalized: 0.7883035603478317, simRaw: 0.5766071206956634, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_60
: 
{querySimilarity: 0.595760468901057, querySimilarityNormalized: 0.7978802344505285, simRaw: 0.595760468901057, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_61
: 
{querySimilarity: 0.5759634409394293, querySimilarityNormalized: 0.7879817204697146, simRaw: 0.5759634409394293, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_62
: 
{querySimilarity: 0.6061794298164248, querySimilarityNormalized: 0.8030897149082123, simRaw: 0.6061794298164248, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_63
: 
{querySimilarity: 0.6491604377288258, querySimilarityNormalized: 0.8245802188644129, simRaw: 0.6491604377288258, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_64
: 
{querySimilarity: 0.6298386890779525, querySimilarityNormalized: 0.8149193445389762, simRaw: 0.6298386890779525, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_65
: 
{querySimilarity: 0.5575792535541988, querySimilarityNormalized: 0.7787896267770994, simRaw: 0.5575792535541988, embeddingSource: 'statement', paragraphSimRaw: 0.7394341472075394, …}
s_66
: 
{querySimilarity: 0.5561489937725533, querySimilarityNormalized: 0.7780744968862767, simRaw: 0.5561489937725533, embeddingSource: 'statement', paragraphSimRaw: 0.7456118267832684, …}
s_67
: 
{querySimilarity: 0.5367673725540116, querySimilarityNormalized: 0.7683836862770058, simRaw: 0.5367673725540116, embeddingSource: 'statement', paragraphSimRaw: 0.7456118267832684, …}
s_68
: 
{querySimilarity: 0.6730572095396554, querySimilarityNormalized: 0.8365286047698277, simRaw: 0.6730572095396554, embeddingSource: 'statement', paragraphSimRaw: 0.7456118267832684, …}
s_69
: 
{querySimilarity: 0.6458804058680188, querySimilarityNormalized: 0.8229402029340094, simRaw: 0.6458804058680188, embeddingSource: 'statement', paragraphSimRaw: 0.7456118267832684, …}
s_70
: 
{querySimilarity: 0.6242398589511526, querySimilarityNormalized: 0.8121199294755763, simRaw: 0.6242398589511526, embeddingSource: 'statement', paragraphSimRaw: 0.6200921496934431, …}
s_71
: 
{querySimilarity: 0.5570059527102669, querySimilarityNormalized: 0.7785029763551334, simRaw: 0.5570059527102669, embeddingSource: 'statement', paragraphSimRaw: 0.7714911240883687, …}
s_72
: 
{querySimilarity: 0.5788844023640071, querySimilarityNormalized: 0.7894422011820035, simRaw: 0.5788844023640071, embeddingSource: 'statement', paragraphSimRaw: 0.7714911240883687, …}
s_73
: 
{querySimilarity: 0.7139879485090053, querySimilarityNormalized: 0.8569939742545026, simRaw: 0.7139879485090053, embeddingSource: 'statement', paragraphSimRaw: 0.7714911240883687, …}
s_74
: 
{querySimilarity: 0.5244384077659826, querySimilarityNormalized: 0.7622192038829914, simRaw: 0.5244384077659826, embeddingSource: 'statement', paragraphSimRaw: 0.7714911240883687, …}
s_75
: 
{querySimilarity: 0.6613527475784596, querySimilarityNormalized: 0.8306763737892298, simRaw: 0.6613527475784596, embeddingSource: 'statement', paragraphSimRaw: 0.7714911240883687, …}
s_76
: 
{querySimilarity: 0.5768086543821682, querySimilarityNormalized: 0.7884043271910841, simRaw: 0.5768086543821682, embeddingSource: 'statement', paragraphSimRaw: 0.7714911240883687, …}
s_77
: 
{querySimilarity: 0.6095657951053408, querySimilarityNormalized: 0.8047828975526704, simRaw: 0.6095657951053408, embeddingSource: 'statement', paragraphSimRaw: 0.6603901638223517, …}
s_78
: 
{querySimilarity: 0.4912071509352756, querySimilarityNormalized: 0.7456035754676378, simRaw: 0.4912071509352756, embeddingSource: 'statement', paragraphSimRaw: 0.6603901638223517, …}
s_79
: 
{querySimilarity: 0.5656869871610675, querySimilarityNormalized: 0.7828434935805337, simRaw: 0.5656869871610675, embeddingSource: 'statement', paragraphSimRaw: 0.6226336717175956, …}
s_80
: 
{querySimilarity: 0.5666184828530632, querySimilarityNormalized: 0.7833092414265316, simRaw: 0.5666184828530632, embeddingSource: 'statement', paragraphSimRaw: 0.6226336717175956, …}
s_81
: 
{querySimilarity: 0.6891567367421606, querySimilarityNormalized: 0.8445783683710804, simRaw: 0.6891567367421606, embeddingSource: 'statement', paragraphSimRaw: 0.7536853309545128, …}
s_82
: 
{querySimilarity: 0.6541590848822527, querySimilarityNormalized: 0.8270795424411264, simRaw: 0.6541590848822527, embeddingSource: 'statement', paragraphSimRaw: 0.7536853309545128, …}
s_83
: 
{querySimilarity: 0.608463872488423, querySimilarityNormalized: 0.8042319362442115, simRaw: 0.608463872488423, embeddingSource: 'statement', paragraphSimRaw: 0.7731225063535435, …}
s_84
: 
{querySimilarity: 0.7364286433967615, querySimilarityNormalized: 0.8682143216983808, simRaw: 0.7364286433967615, embeddingSource: 'statement', paragraphSimRaw: 0.7731225063535435, …}
s_85
: 
{querySimilarity: 0.5870947304556418, querySimilarityNormalized: 0.7935473652278209, simRaw: 0.5870947304556418, embeddingSource: 'statement', paragraphSimRaw: 0.6846320778378936, …}
s_86
: 
{querySimilarity: 0.6001314846204487, querySimilarityNormalized: 0.8000657423102244, simRaw: 0.6001314846204487, embeddingSource: 'statement', paragraphSimRaw: 0.6846320778378936, …}
s_87
: 
{querySimilarity: 0.6042159851244598, querySimilarityNormalized: 0.8021079925622299, simRaw: 0.6042159851244598, embeddingSource: 'statement', paragraphSimRaw: 0.6846320778378936, …}
s_88
: 
{querySimilarity: 0.6000710551971477, querySimilarityNormalized: 0.8000355275985738, simRaw: 0.6000710551971477, embeddingSource: 'statement', paragraphSimRaw: 0.6846320778378936, …}
s_89
: 
{querySimilarity: 0.5395825355732387, querySimilarityNormalized: 0.7697912677866193, simRaw: 0.5395825355732387, embeddingSource: 'statement', paragraphSimRaw: 0.5481201643629499, …}
s_90
: 
{querySimilarity: 0.6115454400666845, querySimilarityNormalized: 0.8057727200333422, simRaw: 0.6115454400666845, embeddingSource: 'statement', paragraphSimRaw: 0.6466824381304542, …}
s_91
: 
{querySimilarity: 0.5612680101900847, querySimilarityNormalized: 0.7806340050950423, simRaw: 0.5612680101900847, embeddingSource: 'statement', paragraphSimRaw: 0.6466824381304542, …}
s_92
: 
{querySimilarity: 0.5691245029507648, querySimilarityNormalized: 0.7845622514753824, simRaw: 0.5691245029507648, embeddingSource: 'statement', paragraphSimRaw: 0.6466824381304542, …}
s_93
: 
{querySimilarity: 0.5126840749532322, querySimilarityNormalized: 0.7563420374766161, simRaw: 0.5126840749532322, embeddingSource: 'statement', paragraphSimRaw: 0.667166422067831, …}
s_94
: 
{querySimilarity: 0.5978408270251464, querySimilarityNormalized: 0.7989204135125731, simRaw: 0.5978408270251464, embeddingSource: 'statement', paragraphSimRaw: 0.667166422067831, …}
s_95
: 
{querySimilarity: 0.5616001511689322, querySimilarityNormalized: 0.7808000755844662, simRaw: 0.5616001511689322, embeddingSource: 'statement', paragraphSimRaw: 0.6025439284325534, …}
s_96
: 
{querySimilarity: 0.6175929353707538, querySimilarityNormalized: 0.8087964676853769, simRaw: 0.6175929353707538, embeddingSource: 'statement', paragraphSimRaw: 0.6025439284325534, …}
s_97
: 
{querySimilarity: 0.6085662228786246, querySimilarityNormalized: 0.8042831114393123, simRaw: 0.6085662228786246, embeddingSource: 'statement', paragraphSimRaw: 0.5964430409580539, …}
s_98
: 
{querySimilarity: 0.5944869460515163, querySimilarityNormalized: 0.7972434730257582, simRaw: 0.5944869460515163, embeddingSource: 'statement', paragraphSimRaw: 0.7354271192166736, …}
s_99
: 
{querySimilarity: 0.6544244917847615, querySimilarityNormalized: 0.8272122458923807, simRaw: 0.6544244917847615, embeddingSource: 'statement', paragraphSimRaw: 0.7354271192166736, …}
s_100
: 
{querySimilarity: 0.6471439953443212, querySimilarityNormalized: 0.8235719976721606, simRaw: 0.6471439953443212, embeddingSource: 'statement', paragraphSimRaw: 0.661278412699993, …}
s_101
: 
{querySimilarity: 0.5962063989530001, querySimilarityNormalized: 0.7981031994765, simRaw: 0.5962063989530001, embeddingSource: 'statement', paragraphSimRaw: 0.5988686613406992, …}
substrate
: 
allPairwiseSimilarities
: 
Array(703)
[0 … 99]
0
: 
0.714013
1
: 
0.677763
2
: 
0.723659
3
: 
0.713111
4
: 
0.702683
5
: 
0.780163
6
: 
0.701315
7
: 
0.78098
8
: 
0.700255
9
: 
0.673459
10
: 
0.731014
11
: 
0.746352
12
: 
0.719833
13
: 
0.748866
14
: 
0.759367
15
: 
0.739154
16
: 
0.75891
17
: 
0.686492
18
: 
0.655594
19
: 
0.703373
20
: 
0.826278
21
: 
0.716305
22
: 
0.65913
23
: 
0.757315
24
: 
0.722275
25
: 
0.669879
26
: 
0.774187
27
: 
0.792811
28
: 
0.7726
29
: 
0.622175
30
: 
0.570626
31
: 
0.721733
32
: 
0.743756
33
: 
0.669452
34
: 
0.727248
35
: 
0.711684
36
: 
0.657184
37
: 
0.679061
38
: 
0.720532
39
: 
0.666011
40
: 
0.693597
41
: 
0.691109
42
: 
0.659142
43
: 
0.789613
44
: 
0.715951
45
: 
0.842773
46
: 
0.67165
47
: 
0.686267
48
: 
0.655443
49
: 
0.777288
50
: 
0.712462
51
: 
0.695743
52
: 
0.732066
53
: 
0.654874
54
: 
0.637763
55
: 
0.651758
56
: 
0.725353
57
: 
0.705952
58
: 
0.650751
59
: 
0.698992
60
: 
0.671289
61
: 
0.651743
62
: 
0.71253
63
: 
0.652559
64
: 
0.808414
65
: 
0.584156
66
: 
0.610206
67
: 
0.682471
68
: 
0.639893
69
: 
0.584597
70
: 
0.720607
71
: 
0.694043
72
: 
0.605575
73
: 
0.678473
74
: 
0.597
75
: 
0.706209
76
: 
0.720821
77
: 
0.619258
78
: 
0.675872
79
: 
0.741261
80
: 
0.667884
81
: 
0.68362
82
: 
0.665027
83
: 
0.619574
84
: 
0.679284
85
: 
0.702662
86
: 
0.720673
87
: 
0.667189
88
: 
0.63229
89
: 
0.621443
90
: 
0.598732
91
: 
0.699984
92
: 
0.675554
93
: 
0.673433
94
: 
0.702906
95
: 
0.633504
96
: 
0.618763
97
: 
0.636807
98
: 
0.651017
99
: 
0.673752
[100 … 199]
[200 … 299]
[300 … 399]
[400 … 499]
[500 … 599]
[600 … 699]
[700 … 702]
length
: 
703
[[Prototype]]
: 
Array(0)
edges
: 
Array(145)
[0 … 99]
0
: 
rank
: 
5
similarity
: 
0.75891
source
: 
"p_17"
target
: 
"p_0"
1
: 
{source: 'p_19', target: 'p_0', similarity: 0.655594, rank: 5}
2
: 
{source: 'p_0', target: 'p_21', similarity: 0.826278, rank: 1}
3
: 
{source: 'p_0', target: 'p_27', similarity: 0.774187, rank: 5}
4
: 
{source: 'p_0', target: 'p_28', similarity: 0.792811, rank: 2}
5
: 
{source: 'p_29', target: 'p_0', similarity: 0.7726, rank: 4}
6
: 
{source: 'p_33', target: 'p_0', similarity: 0.743756, rank: 2}
7
: 
{source: 'p_4', target: 'p_0', similarity: 0.713111, rank: 3}
8
: 
{source: 'p_0', target: 'p_6', similarity: 0.780163, rank: 4}
9
: 
{source: 'p_7', target: 'p_0', similarity: 0.701315, rank: 3}
10
: 
{source: 'p_0', target: 'p_8', similarity: 0.78098, rank: 3}
11
: 
{source: 'p_1', target: 'p_10', similarity: 0.842773, rank: 1}
12
: 
{source: 'p_1', target: 'p_14', similarity: 0.777288, rank: 4}
13
: 
{source: 'p_1', target: 'p_17', similarity: 0.732066, rank: 5}
14
: 
{source: 'p_1', target: 'p_29', similarity: 0.808414, rank: 2}
15
: 
{source: 'p_1', target: 'p_8', similarity: 0.789613, rank: 3}
16
: 
{source: 'p_10', target: 'p_15', similarity: 0.700297, rank: 5}
17
: 
{source: 'p_10', target: 'p_17', similarity: 0.730733, rank: 3}
18
: 
{source: 'p_10', target: 'p_29', similarity: 0.723123, rank: 4}
19
: 
{source: 'p_3', target: 'p_10', similarity: 0.74292, rank: 4}
20
: 
{source: 'p_11', target: 'p_15', similarity: 0.787174, rank: 1}
21
: 
{source: 'p_11', target: 'p_16', similarity: 0.739086, rank: 5}
22
: 
{source: 'p_11', target: 'p_21', similarity: 0.760703, rank: 2}
23
: 
{source: 'p_11', target: 'p_22', similarity: 0.746305, rank: 3}
24
: 
{source: 'p_11', target: 'p_24', similarity: 0.744407, rank: 4}
25
: 
{source: 'p_31', target: 'p_11', similarity: 0.701361, rank: 4}
26
: 
{source: 'p_12', target: 'p_13', similarity: 0.771116, rank: 4}
27
: 
{source: 'p_12', target: 'p_14', similarity: 0.811795, rank: 1}
28
: 
{source: 'p_12', target: 'p_17', similarity: 0.768485, rank: 5}
29
: 
{source: 'p_18', target: 'p_12', similarity: 0.756508, rank: 5}
30
: 
{source: 'p_20', target: 'p_12', similarity: 0.730983, rank: 1}
31
: 
{source: 'p_12', target: 'p_28', similarity: 0.776403, rank: 3}
32
: 
{source: 'p_32', target: 'p_12', similarity: 0.731392, rank: 4}
33
: 
{source: 'p_36', target: 'p_12', similarity: 0.755665, rank: 2}
34
: 
{source: 'p_37', target: 'p_12', similarity: 0.750935, rank: 1}
35
: 
{source: 'p_4', target: 'p_12', similarity: 0.722853, rank: 2}
36
: 
{source: 'p_5', target: 'p_12', similarity: 0.75086, rank: 5}
37
: 
{source: 'p_7', target: 'p_12', similarity: 0.725619, rank: 2}
38
: 
{source: 'p_12', target: 'p_8', similarity: 0.787441, rank: 2}
39
: 
{source: 'p_13', target: 'p_18', similarity: 0.846549, rank: 1}
40
: 
{source: 'p_20', target: 'p_13', similarity: 0.729012, rank: 2}
41
: 
{source: 'p_13', target: 'p_25', similarity: 0.8109, rank: 3}
42
: 
{source: 'p_13', target: 'p_26', similarity: 0.812684, rank: 2}
43
: 
{source: 'p_30', target: 'p_13', similarity: 0.718918, rank: 1}
44
: 
{source: 'p_34', target: 'p_13', similarity: 0.70957, rank: 1}
45
: 
{source: 'p_13', target: 'p_36', similarity: 0.775776, rank: 5}
46
: 
{source: 'p_6', target: 'p_13', similarity: 0.788383, rank: 3}
47
: 
{source: 'p_14', target: 'p_17', similarity: 0.801867, rank: 4}
48
: 
{source: 'p_14', target: 'p_21', similarity: 0.812372, rank: 2}
49
: 
{source: 'p_27', target: 'p_14', similarity: 0.761594, rank: 2}
50
: 
{source: 'p_28', target: 'p_14', similarity: 0.761195, rank: 4}
51
: 
{source: 'p_29', target: 'p_14', similarity: 0.771098, rank: 5}
52
: 
{source: 'p_35', target: 'p_14', similarity: 0.733067, rank: 5}
53
: 
{source: 'p_36', target: 'p_14', similarity: 0.742293, rank: 5}
54
: 
{source: 'p_37', target: 'p_14', similarity: 0.739263, rank: 2}
55
: 
{source: 'p_7', target: 'p_14', similarity: 0.689888, rank: 4}
56
: 
{source: 'p_8', target: 'p_14', similarity: 0.87057, rank: 1}
57
: 
{source: 'p_15', target: 'p_21', similarity: 0.809347, rank: 2}
58
: 
{source: 'p_15', target: 'p_22', similarity: 0.785003, rank: 5}
59
: 
{source: 'p_15', target: 'p_24', similarity: 0.82472, rank: 1}
60
: 
{source: 'p_3', target: 'p_15', similarity: 0.758606, rank: 1}
61
: 
{source: 'p_31', target: 'p_15', similarity: 0.739341, rank: 1}
62
: 
{source: 'p_33', target: 'p_15', similarity: 0.723795, rank: 4}
63
: 
{source: 'p_9', target: 'p_15', similarity: 0.807385, rank: 2}
64
: 
{source: 'p_19', target: 'p_16', similarity: 0.6642, rank: 4}
65
: 
{source: 'p_2', target: 'p_16', similarity: 0.720673, rank: 3}
66
: 
{source: 'p_16', target: 'p_22', similarity: 0.756163, rank: 4}
67
: 
{source: 'p_23', target: 'p_16', similarity: 0.711297, rank: 2}
68
: 
{source: 'p_16', target: 'p_24', similarity: 0.771265, rank: 2}
69
: 
{source: 'p_31', target: 'p_16', similarity: 0.720301, rank: 2}
70
: 
{source: 'p_5', target: 'p_16', similarity: 0.773713, rank: 2}
71
: 
{source: 'p_16', target: 'p_6', similarity: 0.745897, rank: 5}
72
: 
{source: 'p_9', target: 'p_16', similarity: 0.763123, rank: 5}
73
: 
{source: 'p_17', target: 'p_28', similarity: 0.767726, rank: 4}
74
: 
{source: 'p_3', target: 'p_17', similarity: 0.750092, rank: 2}
75
: 
{source: 'p_32', target: 'p_17', similarity: 0.734311, rank: 2}
76
: 
{source: 'p_36', target: 'p_17', similarity: 0.742352, rank: 4}
77
: 
{source: 'p_37', target: 'p_17', similarity: 0.725001, rank: 4}
78
: 
{source: 'p_4', target: 'p_17', similarity: 0.726414, rank: 1}
79
: 
{source: 'p_8', target: 'p_17', similarity: 0.791604, rank: 4}
80
: 
{source: 'p_23', target: 'p_18', similarity: 0.705746, rank: 4}
81
: 
{source: 'p_18', target: 'p_25', similarity: 0.838226, rank: 2}
82
: 
{source: 'p_18', target: 'p_26', similarity: 0.803598, rank: 3}
83
: 
{source: 'p_30', target: 'p_18', similarity: 0.683383, rank: 4}
84
: 
{source: 'p_37', target: 'p_18', similarity: 0.717763, rank: 5}
85
: 
{source: 'p_18', target: 'p_6', similarity: 0.770567, rank: 4}
86
: 
{source: 'p_19', target: 'p_20', similarity: 0.673621, rank: 3}
87
: 
{source: 'p_19', target: 'p_25', similarity: 0.685862, rank: 2}
88
: 
{source: 'p_19', target: 'p_5', similarity: 0.730225, rank: 1}
89
: 
{source: 'p_2', target: 'p_24', similarity: 0.702906, rank: 5}
90
: 
{source: 'p_33', target: 'p_2', similarity: 0.68742, rank: 5}
91
: 
{source: 'p_2', target: 'p_5', similarity: 0.706209, rank: 4}
92
: 
{source: 'p_2', target: 'p_6', similarity: 0.720821, rank: 2}
93
: 
{source: 'p_2', target: 'p_9', similarity: 0.741261, rank: 1}
94
: 
{source: 'p_23', target: 'p_20', similarity: 0.702356, rank: 5}
95
: 
{source: 'p_20', target: 'p_25', similarity: 0.719011, rank: 4}
96
: 
{source: 'p_20', target: 'p_26', similarity: 0.716767, rank: 5}
97
: 
{source: 'p_7', target: 'p_20', similarity: 0.726519, rank: 1}
98
: 
{source: 'p_22', target: 'p_21', similarity: 0.750561, rank: 4}
99
: 
{source: 'p_24', target: 'p_21', similarity: 0.789278, rank: 4}
[100 … 144]
length
: 
145
[[Prototype]]
: 
Array(0)
extendedSimilarityStats
: 
count
: 
190
max
: 
0.87057
mean
: 
0.7599199052631574
min
: 
0.655594
p10
: 
0.702356
p25
: 
0.729012
p50
: 
0.761236
p75
: 
0.789613
p80
: 
0.800634
p90
: 
0.812372
p95
: 
0.838226
stddev
: 
0.04377892957482333
mutualEdges
: 
Array(45)
0
: 
rank
: 
1
similarity
: 
0.826278
source
: 
"p_0"
target
: 
"p_21"
1
: 
{source: 'p_0', target: 'p_27', similarity: 0.774187, rank: 1}
2
: 
{source: 'p_0', target: 'p_28', similarity: 0.792811, rank: 1}
3
: 
{source: 'p_0', target: 'p_6', similarity: 0.780163, rank: 4}
4
: 
{source: 'p_1', target: 'p_10', similarity: 0.842773, rank: 1}
5
: 
{source: 'p_1', target: 'p_14', similarity: 0.777288, rank: 4}
6
: 
{source: 'p_1', target: 'p_29', similarity: 0.808414, rank: 2}
7
: 
{source: 'p_1', target: 'p_8', similarity: 0.789613, rank: 3}
8
: 
{source: 'p_3', target: 'p_10', similarity: 0.74292, rank: 2}
9
: 
{source: 'p_11', target: 'p_15', similarity: 0.787174, rank: 1}
10
: 
{source: 'p_11', target: 'p_22', similarity: 0.746305, rank: 3}
11
: 
{source: 'p_12', target: 'p_14', similarity: 0.811795, rank: 1}
12
: 
{source: 'p_12', target: 'p_17', similarity: 0.768485, rank: 3}
13
: 
{source: 'p_12', target: 'p_28', similarity: 0.776403, rank: 2}
14
: 
{source: 'p_13', target: 'p_18', similarity: 0.846549, rank: 1}
15
: 
{source: 'p_13', target: 'p_25', similarity: 0.8109, rank: 2}
16
: 
{source: 'p_13', target: 'p_26', similarity: 0.812684, rank: 1}
17
: 
{source: 'p_13', target: 'p_36', similarity: 0.775776, rank: 1}
18
: 
{source: 'p_6', target: 'p_13', similarity: 0.788383, rank: 3}
19
: 
{source: 'p_14', target: 'p_17', similarity: 0.801867, rank: 1}
20
: 
{source: 'p_14', target: 'p_21', similarity: 0.812372, rank: 2}
21
: 
{source: 'p_8', target: 'p_14', similarity: 0.87057, rank: 1}
22
: 
{source: 'p_15', target: 'p_21', similarity: 0.809347, rank: 2}
23
: 
{source: 'p_15', target: 'p_22', similarity: 0.785003, rank: 1}
24
: 
{source: 'p_15', target: 'p_24', similarity: 0.82472, rank: 1}
25
: 
{source: 'p_9', target: 'p_15', similarity: 0.807385, rank: 2}
26
: 
{source: 'p_16', target: 'p_22', similarity: 0.756163, rank: 3}
27
: 
{source: 'p_16', target: 'p_24', similarity: 0.771265, rank: 2}
28
: 
{source: 'p_5', target: 'p_16', similarity: 0.773713, rank: 1}
29
: 
{source: 'p_9', target: 'p_16', similarity: 0.763123, rank: 3}
30
: 
{source: 'p_17', target: 'p_28', similarity: 0.767726, rank: 3}
31
: 
{source: 'p_8', target: 'p_17', similarity: 0.791604, rank: 2}
32
: 
{source: 'p_18', target: 'p_25', similarity: 0.838226, rank: 1}
33
: 
{source: 'p_18', target: 'p_26', similarity: 0.803598, rank: 2}
34
: 
{source: 'p_7', target: 'p_20', similarity: 0.726519, rank: 1}
35
: 
{source: 'p_6', target: 'p_21', similarity: 0.849327, rank: 1}
36
: 
{source: 'p_8', target: 'p_21', similarity: 0.799613, rank: 3}
37
: 
{source: 'p_5', target: 'p_22', similarity: 0.771544, rank: 2}
38
: 
{source: 'p_6', target: 'p_24', similarity: 0.798921, rank: 2}
39
: 
{source: 'p_9', target: 'p_24', similarity: 0.832346, rank: 1}
40
: 
{source: 'p_25', target: 'p_26', similarity: 0.764175, rank: 4}
41
: 
{source: 'p_25', target: 'p_36', similarity: 0.746248, rank: 3}
42
: 
{source: 'p_8', target: 'p_29', similarity: 0.811024, rank: 1}
43
: 
{source: 'p_9', target: 'p_35', similarity: 0.800634, rank: 1}
44
: 
{source: 'p_5', target: 'p_6', similarity: 0.776296, rank: 1}
length
: 
45
nodes
: 
Array(38)
0
: 
avgTopKSim
: 
0.790884
componentId
: 
"comp_0"
contested
: 
false
dominantStance
: 
"assertive"
isolationScore
: 
0.173722
modelIndex
: 
1
mutualDegree
: 
4
paragraphId
: 
"p_0"
regionId
: 
"r_0"
statementIds
: 
Array(3)
0
: 
"s_0"
1
: 
"s_1"
2
: 
"s_2"
length
: 
3
strongDegree
: 
3
top1Sim
: 
0.826278
x
: 
1
y
: 
0.015297785267937236
1
: 
{paragraphId: 'p_1', modelIndex: 1, dominantStance: 'assertive', contested: false, statementIds: Array(3), …}
2
: 
{paragraphId: 'p_10', modelIndex: 2, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
3
: 
{paragraphId: 'p_11', modelIndex: 2, dominantStance: 'assertive', contested: false, statementIds: Array(4), …}
4
: 
{paragraphId: 'p_12', modelIndex: 2, dominantStance: 'unclassified', contested: false, statementIds: Array(2), …}
5
: 
{paragraphId: 'p_13', modelIndex: 3, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
6
: 
{paragraphId: 'p_14', modelIndex: 3, dominantStance: 'assertive', contested: false, statementIds: Array(4), …}
7
: 
{paragraphId: 'p_15', modelIndex: 3, dominantStance: 'cautionary', contested: true, statementIds: Array(5), …}
8
: 
{paragraphId: 'p_16', modelIndex: 3, dominantStance: 'prescriptive', contested: false, statementIds: Array(3), …}
9
: 
{paragraphId: 'p_17', modelIndex: 3, dominantStance: 'unclassified', contested: false, statementIds: Array(2), …}
10
: 
{paragraphId: 'p_18', modelIndex: 4, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
11
: 
{paragraphId: 'p_19', modelIndex: 4, dominantStance: 'assertive', contested: false, statementIds: Array(1), …}
12
: 
{paragraphId: 'p_2', modelIndex: 1, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
13
: 
{paragraphId: 'p_20', modelIndex: 4, dominantStance: 'assertive', contested: false, statementIds: Array(1), …}
14
: 
{paragraphId: 'p_21', modelIndex: 4, dominantStance: 'assertive', contested: false, statementIds: Array(8), …}
15
: 
{paragraphId: 'p_22', modelIndex: 4, dominantStance: 'cautionary', contested: true, statementIds: Array(4), …}
16
: 
{paragraphId: 'p_23', modelIndex: 4, dominantStance: 'uncertain', contested: false, statementIds: Array(1), …}
17
: 
{paragraphId: 'p_24', modelIndex: 4, dominantStance: 'assertive', contested: false, statementIds: Array(6), …}
18
: 
{paragraphId: 'p_25', modelIndex: 4, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
19
: 
{paragraphId: 'p_26', modelIndex: 5, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
20
: 
{paragraphId: 'p_27', modelIndex: 5, dominantStance: 'unclassified', contested: false, statementIds: Array(2), …}
21
: 
{paragraphId: 'p_28', modelIndex: 5, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
22
: 
{paragraphId: 'p_29', modelIndex: 5, dominantStance: 'cautionary', contested: false, statementIds: Array(4), …}
23
: 
{paragraphId: 'p_3', modelIndex: 1, dominantStance: 'uncertain', contested: true, statementIds: Array(3), …}
24
: 
{paragraphId: 'p_30', modelIndex: 5, dominantStance: 'unclassified', contested: false, statementIds: Array(1), …}
25
: 
{paragraphId: 'p_31', modelIndex: 5, dominantStance: 'assertive', contested: false, statementIds: Array(3), …}
26
: 
{paragraphId: 'p_32', modelIndex: 5, dominantStance: 'uncertain', contested: true, statementIds: Array(2), …}
27
: 
{paragraphId: 'p_33', modelIndex: 5, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
28
: 
{paragraphId: 'p_34', modelIndex: 5, dominantStance: 'unclassified', contested: false, statementIds: Array(1), …}
29
: 
{paragraphId: 'p_35', modelIndex: 5, dominantStance: 'uncertain', contested: false, statementIds: Array(2), …}
30
: 
{paragraphId: 'p_36', modelIndex: 5, dominantStance: 'unclassified', contested: false, statementIds: Array(1), …}
31
: 
{paragraphId: 'p_37', modelIndex: 5, dominantStance: 'unclassified', contested: false, statementIds: Array(1), …}
32
: 
{paragraphId: 'p_4', modelIndex: 1, dominantStance: 'unclassified', contested: false, statementIds: Array(1), …}
33
: 
{paragraphId: 'p_5', modelIndex: 1, dominantStance: 'assertive', contested: false, statementIds: Array(4), …}
34
: 
{paragraphId: 'p_6', modelIndex: 2, dominantStance: 'assertive', contested: false, statementIds: Array(2), …}
35
: 
{paragraphId: 'p_7', modelIndex: 2, dominantStance: 'uncertain', contested: false, statementIds: Array(1), …}
36
: 
{paragraphId: 'p_8', modelIndex: 2, dominantStance: 'assertive', contested: false, statementIds: Array(6), …}
37
: 
{paragraphId: 'p_9', modelIndex: 2, dominantStance: 'uncertain', contested: true, statementIds: Array(5), …}
length
: 
38
similarityStats
: 
max
: 
0.87057
mean
: 
0.7599199052631574
p50
: 
0.761236
p80
: 
0.800634
p95
: 
0.838226
softThreshold
: 
0.78
strongEdges
: 
Array(28)
0
: 
rank
: 
1
similarity
: 
0.826278
source
: 
"p_0"
target
: 
"p_21"
1
: 
{source: 'p_0', target: 'p_28', similarity: 0.792811, rank: 1}
2
: 
{source: 'p_0', target: 'p_6', similarity: 0.780163, rank: 4}
3
: 
{source: 'p_1', target: 'p_10', similarity: 0.842773, rank: 1}
4
: 
{source: 'p_1', target: 'p_29', similarity: 0.808414, rank: 2}
5
: 
{source: 'p_1', target: 'p_8', similarity: 0.789613, rank: 3}
6
: 
{source: 'p_11', target: 'p_15', similarity: 0.787174, rank: 1}
7
: 
{source: 'p_12', target: 'p_14', similarity: 0.811795, rank: 1}
8
: 
{source: 'p_13', target: 'p_18', similarity: 0.846549, rank: 1}
9
: 
{source: 'p_13', target: 'p_25', similarity: 0.8109, rank: 2}
10
: 
{source: 'p_13', target: 'p_26', similarity: 0.812684, rank: 1}
11
: 
{source: 'p_6', target: 'p_13', similarity: 0.788383, rank: 3}
12
: 
{source: 'p_14', target: 'p_17', similarity: 0.801867, rank: 1}
13
: 
{source: 'p_14', target: 'p_21', similarity: 0.812372, rank: 2}
14
: 
{source: 'p_8', target: 'p_14', similarity: 0.87057, rank: 1}
15
: 
{source: 'p_15', target: 'p_21', similarity: 0.809347, rank: 2}
16
: 
{source: 'p_15', target: 'p_22', similarity: 0.785003, rank: 1}
17
: 
{source: 'p_15', target: 'p_24', similarity: 0.82472, rank: 1}
18
: 
{source: 'p_9', target: 'p_15', similarity: 0.807385, rank: 2}
19
: 
{source: 'p_8', target: 'p_17', similarity: 0.791604, rank: 2}
20
: 
{source: 'p_18', target: 'p_25', similarity: 0.838226, rank: 1}
21
: 
{source: 'p_18', target: 'p_26', similarity: 0.803598, rank: 2}
22
: 
{source: 'p_6', target: 'p_21', similarity: 0.849327, rank: 1}
23
: 
{source: 'p_8', target: 'p_21', similarity: 0.799613, rank: 3}
24
: 
{source: 'p_6', target: 'p_24', similarity: 0.798921, rank: 2}
25
: 
{source: 'p_9', target: 'p_24', similarity: 0.832346, rank: 1}
26
: 
{source: 'p_8', target: 'p_29', similarity: 0.811024, rank: 1}
27
: 
{source: 'p_9', target: 'p_35', similarity: 0.800634, rank: 1}
length
: 
28
meta
: 
modelCount
: 
5
query
: 
"what u think? \n\n# What Hybrid Thinking OS Does and How the Pipeline Supports It\n\n## For anyone who needs to understand what this system does without reading the engineering documents\n\n---\n\n## The Product\n\nA user asks one question. Six AI models answer independently. The system synthesizes those answers into a single response — but filtered by what actually applies to the user's situation.\n\nThe key insight: the system doesn't ask users what they want upfront. It reads all six model responses, identifies where the models genuinely disagree, and asks the user only the questions whose answers would change the output. After the user answers, the system surgically removes the perspectives the user rejected and synthesizes from what survives.\n\nThe result is a response grounded in multiple models' knowledge, constrained by the user's actual situation, with nothing important silently lost.\n\n---\n\n## What the Geometry Pipeline Does\n\nThe geometry pipeline is the measurement layer that makes surgical pruning possible. It answers three operational questions:\n\n**\"Which parts of the evidence belong to which claims?\"**\nWhen the mapper identifies a claim like \"use TypeScript for type safety,\" the pipeline independently finds which paragraphs across all model outputs actually discuss that idea. It doesn't trust the mapper to get this right — it measures geometric proximity in embedding space and assigns evidence based on each paragraph's own affinity distribution across all claims. Different claims get different-sized evidence pools based on how broadly they're discussed.\n\n**\"What would we lose if we removed this?\"**\nBefore asking the user about any claim, the pipeline measures its blast radius — how much exclusive evidence would disappear, how many other claims would lose support, and how central the claim is to the overall structure. Claims where removal costs little are suppressed from the question queue. Claims where removal is consequential are surfaced. The user is only asked about decisions that matter.\n\n**\"Can this content be safely subtracted?\"**\nWhen the user rejects a claim, the pipeline checks whether each affected statement's content exists elsewhere in surviving evidence. If a carrier exists — another statement saying essentially the same thing — the rejected statement is removed. If no carrier exists, the statement is reduced to its structural skeleton (nouns, numbers, names) rather than deleted entirely. The bones remain even when the argument is removed.\n\n---\n\n## The Protective Bias\n\nThe pipeline's default is preservation. Everything survives unless the user explicitly rejects it and the system can verify the removal is safe. This manifests at every layer:\n\n- **Unclaimed content passes through untouched.** If the mapper doesn't identify something as a claim, it isn't pruned. It reaches synthesis as full-fidelity text. The cost is noise (slightly messier synthesis), never loss (missing perspectives).\n\n- **Low-blast-radius claims aren't asked about.** If removing a claim would lose nothing unique, the system doesn't waste the user's attention on it. The evidence is shared across other claims and survives regardless.\n\n- **Carrier detection is conservative.** A statement is only declared \"carried\" by another statement if the similarity exceeds a high bar — the statement's own local threshold AND a global minimum (the 75th percentile of all pairwise similarities in the field). In practice, most pruned statements get skeletonized rather than removed, because genuine carriers are rare.\n\n- **When the pipeline can't distinguish, it says so.** If the embedding space is too uniform to differentiate claims (everything is about the same topic), the pipeline flags this rather than fabricating boundaries. Downstream consumers see the flag and know the measurements are unreliable.\n\n---\n\n## What You See in the Product\n\n**Forcing points (questions):** The user sees 1-3 questions generated from claims with high blast radius — the decisions that would most change the output. Each question is backed by specific evidence from specific models.\n\n**The synthesized response:** After the user answers, the synthesis receives the original model texts with rejected content surgically removed or skeletonized. The synthesizer works from evidence, not from claim summaries. Full fidelity where the user's reality applies. Structural ghosts where it doesn't.\n\n**Recovery worklist (diagnostics):** Orphan statements — content not captured by any claim — are ranked by how relevant they are to the user's question. This surfaces gaps in the mapper's coverage without requiring the mapper to be perfect.\n\n---\n\n## What the Pipeline Cannot Do\n\n**It cannot understand meaning.** It measures geometric distance between text embeddings. Two statements about the same topic score as similar whether they agree or disagree. \"Drug X is safe\" and \"Drug X is dangerous\" are geometrically close because they're both about Drug X safety. The mapper handles meaning. The pipeline handles measurement.\n\n**It cannot guarantee the mapper is right.** If the mapper fabricates a claim or misses a real tension, the pipeline can flag geometric implausibility (the evidence doesn't cluster the way the claim suggests) but it cannot generate claims or identify semantic relationships. The mapper is the authority on meaning. The pipeline audits the mapper's work geometrically.\n\n**It cannot prevent a user from making a wrong decision.** If the user misunderstands a question and rejects something they actually need, the system faithfully removes it. The architecture makes this recoverable (stored primitives can reconstruct any prior state) but the current product does not yet expose an undo mechanism.\n\n---\n\n## How to Interpret Diagnostic Outputs\n\n**Pool sizes** (per claim): How many paragraphs are geometrically affiliated with this claim. Large pools mean the claim is broadly discussed. Small pools mean it's narrow or niche. Pool size alone doesn't indicate quality — a narrow claim with 6 paragraphs can be more structurally important than a broad claim with 30.\n\n**Exclusivity** (per claim): What fraction of this claim's evidence is unique to it — not shared with any other claim. High exclusivity means pruning this claim loses content that exists nowhere else. Zero exclusivity means everything in this claim's evidence pool is also covered by other claims. Blast radius weights this heavily.\n\n**Blast radius scores**: A composite of exclusive evidence loss, cascade effects, structural centrality, query relevance, and graph connectivity. Higher scores mean the claim is more consequential to ask about. Scores below 0.20 are suppressed — the question isn't worth the user's attention.\n\n**Convergent field / insufficient structure**: The pipeline's honest admission that the embedding space can't differentiate the content meaningfully. This happens when all model outputs are about the same narrow topic. The pipeline still functions but its structural measurements are less informative. This is a property of the query, not a system failure.\n\n---\n\n## Limitations Worth Knowing\n\n**Under-pruning is the expected failure mode.** When the user rejects a claim, some echoes of that rejected perspective may survive in other models' text if the paraphrase sweep doesn't catch them. The user's rejected perspective shows up muted in the synthesis rather than absent. This is by design — the system would rather include something the user didn't want than exclude something they did.\n\n**Homogeneous queries produce weak differentiation.** When all claims are about the same topic domain (e.g., \"how should I set thresholds in my pipeline?\"), claim centroids are close together in embedding space and exclusivity is low. The pipeline correctly reports this as low differentiation rather than fabricating artificial distinctions.\n\n**The quality ceiling is the embedding model.** Every geometric measurement is derived from embedding vectors. If the embedding model can't distinguish two concepts, no amount of pipeline sophistication will separate them. Upgrading the embedding model improves the entire measurement chain without changing any pipeline logic."
timestamp
: 
"2026-02-26T23:07:59.472Z"
semantic
: 
claims
: 
Array(10)
0
: 
challenges
: 
null
hasConditionalSignal
: 
true
hasSequenceSignal
: 
false
hasTensionSignal
: 
true
id
: 
"claim_1"
label
: 
"Prioritize user attention by surfacing only high-consequence decisions"
provenanceBulk
: 
2.5443426366698
provenanceWeights
: 
No properties
role
: 
"supplement"
sourceRegionIds
: 
Array(2)
0
: 
"r_0"
1
: 
"r_8"
length
: 
2
sourceStatementIds
: 
Array(12)
0
: 
"s_0"
1
: 
"s_1"
2
: 
"s_2"
3
: 
"s_49"
4
: 
"s_50"
5
: 
"s_51"
6
: 
"s_85"
7
: 
"s_86"
8
: 
"s_87"
9
: 
"s_88"
10
: 
"s_95"
11
: 
"s_96"
length
: 
12
sourceStatements
: 
Array(12)
0
: 
confidence
: 
0.8
fullParagraph
: 
"This is genuinely interesting work. The core idea — query multiple models, identify *real* disagreements, ask the user only the questions that would actually change the output — is elegant. The \"blast radius\" framing is particularly sharp as a way to prioritize what's worth surfacing vs. silently passing through."
geometricCoordinates
: 
componentId
: 
"comp_0"
isolationScore
: 
0.173722
knnDegree
: 
11
mutualDegree
: 
4
paragraphId
: 
"p_0"
regionId
: 
"r_0"
id
: 
"s_0"
location
: 
paragraphIndex
: 
0
sentenceIndex
: 
0
modelIndex
: 
1
signals
: 
conditional
: 
false
sequence
: 
false
tension
: 
false
stance
: 
"assertive"
text
: 
"This is genuinely interesting work."
1
: 
{id: 's_1', modelIndex: 1, text: 'The core idea — query multiple models, identify *r…at would actually change the output — is elegant.', stance: 'assertive', confidence: 0.65, …}
2
: 
{id: 's_2', modelIndex: 1, text: `The "blast radius" framing is particularly sharp a…t's worth surfacing vs. silently passing through.`, stance: 'assertive', confidence: 0.65, …}
3
: 
{id: 's_49', modelIndex: 3, text: '| Section | Suggestion |\n| :--- | :--- |\n| **The P…m forces the hidden disagreements into the light.', stance: 'unclassified', confidence: 0, …}
4
: 
{id: 's_50', modelIndex: 3, text: `|\n| **The Pipeline** | Use the term **"Semantic Au…the "CPA" checking the "CEO's" (Mapper's) claims.`, stance: 'prescriptive', confidence: 0.325, …}
5
: 
{id: 's_51', modelIndex: 3, text: '|\n| **Limitations** | You might add a note on **La…s a geometric audit is computationally expensive.', stance: 'uncertain', confidence: 0.325, …}
6
: 
{id: 's_85', modelIndex: 5, text: 'Key strengths:  \n- **Evidence-aware pruning**: Doe…stance* survives elsewhere (*carrier detection*).', stance: 'unclassified', confidence: 0, …}
7
: 
{id: 's_86', modelIndex: 5, text: '- **Blast radius scoring**: Prevents trivial decisions from cluttering the UI.', stance: 'unclassified', confidence: 0, …}
8
: 
{id: 's_87', modelIndex: 5, text: '- **Skeletonization**: Even when content is rejected, structural anchors (nouns, numbers) remain.', stance: 'assertive', confidence: 0.65, …}
9
: 
{id: 's_88', modelIndex: 5, text: 'This avoids *false erasure*—a huge risk in summarization systems.', stance: 'cautionary', confidence: 0.65, …}
10
: 
{id: 's_95', modelIndex: 5, text: '- *Low blast radius* = safe to auto-resolve without user input.', stance: 'unclassified', confidence: 0, …}
11
: 
{id: 's_96', modelIndex: 5, text: '- *Convergent field warnings* = "Your query is too narrow for meaningful differentiation."', stance: 'assertive', confidence: 0.65, …}
length
: 
12
supportRatio
: 
1
support_count
: 
5
supporters
: 
Array(5)
0
: 
1
1
: 
2
2
: 
3
3
: 
4
4
: 
5
length
: 
5
text
: 
"The system calculates 'blast radius'—a composite of exclusive evidence loss, cascade effects, and structural centrality—to determine which model disagreements warrant user input, suppressing low-impact claims (score < 0.20)."
type
: 
"assertive"
1
: 
challenges
: 
null
hasConditionalSignal
: 
true
hasSequenceSignal
: 
false
hasTensionSignal
: 
true
id
: 
"claim_2"
label
: 
"Default to preservation over deletion when pruning content"
provenanceBulk
: 
1.5556660163647702
provenanceWeights
: 
No properties
role
: 
"supplement"
sourceRegionIds
: 
Array(1)
0
: 
"r_0"
length
: 
1
sourceStatementIds
: 
Array(9)
0
: 
"s_3"
1
: 
"s_30"
2
: 
"s_31"
3
: 
"s_4"
4
: 
"s_5"
5
: 
"s_85"
6
: 
"s_86"
7
: 
"s_87"
8
: 
"s_88"
length
: 
9
sourceStatements
: 
Array(9)
0
: 
{id: 's_3', modelIndex: 1, text: 'The protective bias section is the strongest part.', stance: 'assertive', confidence: 0.65, …}
1
: 
{id: 's_30', modelIndex: 2, text: 'It’s a "feature" of reality—sometimes things are just similar.', stance: 'assertive', confidence: 0.65, …}
2
: 
{id: 's_31', modelIndex: 2, text: '* **"Under-pruning is the expected failure mode":*…little extra homework than delete your paycheck."', stance: 'assertive', confidence: 0.65, …}
3
: 
{id: 's_4', modelIndex: 1, text: 'Leading with "under-pruning is the expected failur…ate tradeoff rather than just hoping things work.', stance: 'assertive', confidence: 0.8, …}
4
: 
{id: 's_5', modelIndex: 1, text: 'The skeletonization concept (keep the bones when t…is memorable and communicates the intent quickly.', stance: 'assertive', confidence: 0.65, …}
5
: 
{id: 's_85', modelIndex: 5, text: 'Key strengths:  \n- **Evidence-aware pruning**: Doe…stance* survives elsewhere (*carrier detection*).', stance: 'unclassified', confidence: 0, …}
6
: 
{id: 's_86', modelIndex: 5, text: '- **Blast radius scoring**: Prevents trivial decisions from cluttering the UI.', stance: 'unclassified', confidence: 0, …}
7
: 
{id: 's_87', modelIndex: 5, text: '- **Skeletonization**: Even when content is rejected, structural anchors (nouns, numbers) remain.', stance: 'assertive', confidence: 0.65, …}
8
: 
{id: 's_88', modelIndex: 5, text: 'This avoids *false erasure*—a huge risk in summarization systems.', stance: 'cautionary', confidence: 0.65, …}
length
: 
9
supportRatio
: 
1
support_count
: 
5
supporters
: 
Array(5)
0
: 
1
1
: 
2
2
: 
3
3
: 
4
4
: 
5
length
: 
5
text
: 
"Rejected claims are either removed only if a 'carrier' exists elsewhere or reduced to a 'structural skeleton' (nouns, numbers, names); unclaimed content passes through untouched to avoid silent loss."
type
: 
"assertive"
2
: 
{id: 'claim_3', label: 'Acknowledge that geometric proximity cannot distinguish semantic opposition', text: "Embedding space treats 'Drug X is safe' and 'Drug …legated to the Mapper, not the Geometry Pipeline.", supporters: Array(5), challenges: null, …}
3
: 
{id: 'claim_4', label: 'Trust the Mapper as the sole authority on meaning despite its fallibility', text: 'The pipeline audits the Mapper geometrically but c…rface misleading questions or miss real tensions.', supporters: Array(4), challenges: null, …}
4
: 
{id: 'claim_5', label: 'Limit user-facing questions to 1–3 even when more high-blast-radius claims exist', text: 'The product promises only 1–3 questions, raising u… truncated, merged, or deprioritized arbitrarily.', supporters: Array(1), challenges: 'claim_1', …}
5
: 
{id: 'claim_6', label: 'Skeletonized content risks incoherent synthesis without robust final LLM handling', text: "Reducing rejected statements to nouns and numbers …d yield 'ransom-note' text or Frankenstein logic.", supporters: Array(2), challenges: 'claim_2', …}
6
: 
{id: 'claim_7', label: 'Consensus hallucination may pass undetected due to geometric reinforcement', text: "If 4–6 models confidently agree on a false claim, …lucination to survive pruning as 'settled truth.'", supporters: Array(1), challenges: 'claim_2', …}
7
: 
{id: 'claim_8', label: 'Latency from six-model orchestration makes this unsuitable for real-time chat', text: 'The multi-step loop—querying six models, mapping, … high-stakes deliberation, not instant responses.', supporters: Array(2), challenges: null, …}
8
: 
{id: 'claim_9', label: 'Diagnostic outputs enable collaborative sensemaking beyond answer generation', text: 'Metrics like exclusivity, pool size, and convergen…se field rather than just delivering conclusions.', supporters: Array(1), challenges: null, …}
9
: 
{id: 'claim_10', label: 'User misunderstanding of a question can permanently corrupt output without undo', text: 'The system faithfully executes user rejections eve… mechanisms to confirm or reverse such decisions.', supporters: Array(2), challenges: null, …}
length
: 
10
conditionals
: 
Array(0)
length
: 
0
edges
: 
Array(5)
0
: 
from
: 
"claim_5"
to
: 
"claim_1"
type
: 
"conflicts"
1
: 
{from: 'claim_6', to: 'claim_2', type: 'conflicts'}
2
: 
{from: 'claim_7', to: 'claim_2', type: 'conflicts'}
3
: 
{from: 'claim_2', to: 'claim_10', type: 'prerequisite'}
4
: 
{from: 'claim_1', to: 'claim_9', type: 'supports'}
length
: 
5
narrative
: 
"The architecture pivots on a single tradeoff: **fidelity to multiplicity versus fluency of delivery**—how much structural complexity should be preserved when the user rejects a perspective, and at what cost to coherence or speed?\n\nThe models converge on a shared foundation. All five affirm that [Prioritize user attention by surfacing only high-consequence decisions|claim_1] is central to the system’s value, using “blast radius” as the gatekeeper of interruption. Equally settled is [Default to preservation over deletion when pruning content|claim_2]: the protective bias ensures under-pruning, not over-cleaning. And all recognize the hard boundary that [geometric proximity cannot distinguish semantic opposition|claim_3], delegating meaning to the Mapper while the Pipeline measures only spatial affinity.\n\nBut this consensus floor gives way to tension at the edges. Model 1 alone challenges the scalability of attention conservation with [Limit user-facing questions to 1–3 even when more high-blast-radius claims exist|claim_5], exposing a conflict with [claim_1]: if blast radius truly measures consequence, why cap questions arbitrarily? This isn’t refinement—it’s constraint masquerading as curation.\n\nMore critically, two positions challenge the safety of preservation itself. [Skeletonized content risks incoherent synthesis|claim_6] (Models 3, 4) warns that keeping “bones” without “flesh” may fracture the final narrative unless the synthesizer is exceptionally capable. Even sharper is [Consensus hallucination may pass undetected|claim_7] (Model 3), which argues that the very mechanism designed to preserve truth—high evidence density—can amplify falsehood when multiple models err together. Both directly interrogate the premise of [claim_2], suggesting that defaulting to preservation isn’t always epistemically humble—it can be dangerously naive.\n\nThese outliers sit adjacent to dependencies. Note that [claim_2]’s promise of safe pruning becomes precarious without safeguards against [User misunderstanding of a question can permanently corrupt output|claim_10] (Models 1, 5)—a vulnerability made possible precisely because the system trusts user input absolutely. Meanwhile, [Diagnostic outputs enable collaborative sensemaking|claim_9] (Model 5) emerges not as an add-on but as a natural extension of [claim_1]: if you measure consequence, you must show the metrics.\n\nUncharted remain three ghosts. First: **How does the Mapper actually work?** Every model assumes its competence but none describe its logic—leaving a black box at the heart of meaning-making. Second: **What defines a “carrier” beyond similarity thresholds?** The pipeline’s conservative bar avoids false equivalence, but no model explains how semantic equivalence is approximated without understanding meaning. Third: **Who is the user?** Is this for engineers debugging architectures or executives needing crisp recommendations? The tone straddles both, but the embedding jargon and skeleton metaphors may not survive translation across that divide.\n\nThe landscape, then, is not flat consensus but layered caution: a core of agreed principles surrounded by concentric rings of risk—implementation fragility, synthesis brittleness, and epistemic blind spots—each revealed not by disagreement among models, but by what only one dared to name."
shadow
: 
audit
: 
No properties
delta
: 
null
paragraphs
: 
Array(38)
0
: 
confidence
: 
0.8
contested
: 
false
dominantStance
: 
"assertive"
id
: 
"p_0"
modelIndex
: 
1
paragraphIndex
: 
0
signals
: 
conditional
: 
false
sequence
: 
false
tension
: 
true
stanceHints
: 
Array(1)
0
: 
"assertive"
length
: 
1
statementIds
: 
Array(3)
0
: 
"s_0"
1
: 
"s_1"
2
: 
"s_2"
length
: 
3
statements
: 
Array(3)
0
: 
id
: 
"s_0"
signals
: 
Array(0)
length
: 
0
stance
: 
"assertive"
text
: 
"This is genuinely interesting work."
1
: 
{id: 's_1', text: 'The core idea — query multiple models, identify *r…at would actually change the output — is elegant.', stance: 'assertive', signals: Array(0)}
2
: 
{id: 's_2', text: `The "blast radius" framing is particularly sharp a…t's worth surfacing vs. silently passing through.`, stance: 'assertive', signals: Array(1)}
length
: 
3
_fullParagraph
: 
"This is genuinely interesting work. The core idea — query multiple models, identify *real* disagreements, ask the user only the questions that would actually change the output — is elegant. The \"blast radius\" framing is particularly sharp as a way to prioritize what's worth surfacing vs. silently passing through."
1
: 
{id: 'p_1', modelIndex: 1, paragraphIndex: 3, statementIds: Array(3), dominantStance: 'assertive', …}
2
: 
{id: 'p_2', modelIndex: 1, paragraphIndex: 4, statementIds: Array(2), dominantStance: 'assertive', …}
3
: 
{id: 'p_3', modelIndex: 1, paragraphIndex: 6, statementIds: Array(3), dominantStance: 'uncertain', …}
4
: 
{id: 'p_4', modelIndex: 1, paragraphIndex: 7, statementIds: Array(1), dominantStance: 'unclassified', …}
5
: 
{id: 'p_5', modelIndex: 1, paragraphIndex: 9, statementIds: Array(4), dominantStance: 'assertive', …}
6
: 
{id: 'p_6', modelIndex: 2, paragraphIndex: 0, statementIds: Array(2), dominantStance: 'assertive', …}
7
: 
{id: 'p_7', modelIndex: 2, paragraphIndex: 1, statementIds: Array(1), dominantStance: 'uncertain', …}
8
: 
{id: 'p_8', modelIndex: 2, paragraphIndex: 2, statementIds: Array(6), dominantStance: 'assertive', …}
9
: 
{id: 'p_9', modelIndex: 2, paragraphIndex: 3, statementIds: Array(5), dominantStance: 'uncertain', …}
10
: 
{id: 'p_10', modelIndex: 2, paragraphIndex: 4, statementIds: Array(2), dominantStance: 'assertive', …}
11
: 
{id: 'p_11', modelIndex: 2, paragraphIndex: 6, statementIds: Array(4), dominantStance: 'assertive', …}
12
: 
{id: 'p_12', modelIndex: 2, paragraphIndex: 8, statementIds: Array(2), dominantStance: 'unclassified', …}
13
: 
{id: 'p_13', modelIndex: 3, paragraphIndex: 0, statementIds: Array(2), dominantStance: 'assertive', …}
14
: 
{id: 'p_14', modelIndex: 3, paragraphIndex: 2, statementIds: Array(4), dominantStance: 'assertive', …}
15
: 
{id: 'p_15', modelIndex: 3, paragraphIndex: 3, statementIds: Array(5), dominantStance: 'cautionary', …}
16
: 
{id: 'p_16', modelIndex: 3, paragraphIndex: 6, statementIds: Array(3), dominantStance: 'prescriptive', …}
17
: 
{id: 'p_17', modelIndex: 3, paragraphIndex: 7, statementIds: Array(2), dominantStance: 'unclassified', …}
18
: 
{id: 'p_18', modelIndex: 4, paragraphIndex: 0, statementIds: Array(2), dominantStance: 'assertive', …}
19
: 
{id: 'p_19', modelIndex: 4, paragraphIndex: 1, statementIds: Array(1), dominantStance: 'assertive', …}
20
: 
{id: 'p_20', modelIndex: 4, paragraphIndex: 2, statementIds: Array(1), dominantStance: 'assertive', …}
21
: 
{id: 'p_21', modelIndex: 4, paragraphIndex: 4, statementIds: Array(8), dominantStance: 'assertive', …}
22
: 
{id: 'p_22', modelIndex: 4, paragraphIndex: 6, statementIds: Array(4), dominantStance: 'cautionary', …}
23
: 
{id: 'p_23', modelIndex: 4, paragraphIndex: 8, statementIds: Array(1), dominantStance: 'uncertain', …}
24
: 
{id: 'p_24', modelIndex: 4, paragraphIndex: 9, statementIds: Array(6), dominantStance: 'assertive', …}
25
: 
{id: 'p_25', modelIndex: 4, paragraphIndex: 11, statementIds: Array(2), dominantStance: 'assertive', …}
26
: 
{id: 'p_26', modelIndex: 5, paragraphIndex: 0, statementIds: Array(2), dominantStance: 'assertive', …}
27
: 
{id: 'p_27', modelIndex: 5, paragraphIndex: 3, statementIds: Array(2), dominantStance: 'unclassified', …}
28
: 
{id: 'p_28', modelIndex: 5, paragraphIndex: 4, statementIds: Array(2), dominantStance: 'assertive', …}
29
: 
{id: 'p_29', modelIndex: 5, paragraphIndex: 6, statementIds: Array(4), dominantStance: 'cautionary', …}
30
: 
{id: 'p_30', modelIndex: 5, paragraphIndex: 7, statementIds: Array(1), dominantStance: 'unclassified', …}
31
: 
{id: 'p_31', modelIndex: 5, paragraphIndex: 9, statementIds: Array(3), dominantStance: 'assertive', …}
32
: 
{id: 'p_32', modelIndex: 5, paragraphIndex: 10, statementIds: Array(2), dominantStance: 'uncertain', …}
33
: 
{id: 'p_33', modelIndex: 5, paragraphIndex: 12, statementIds: Array(2), dominantStance: 'assertive', …}
34
: 
{id: 'p_34', modelIndex: 5, paragraphIndex: 13, statementIds: Array(1), dominantStance: 'unclassified', …}
35
: 
{id: 'p_35', modelIndex: 5, paragraphIndex: 15, statementIds: Array(2), dominantStance: 'uncertain', …}
36
: 
{id: 'p_36', modelIndex: 5, paragraphIndex: 17, statementIds: Array(1), dominantStance: 'unclassified', …}
37
: 
{id: 'p_37', modelIndex: 5, paragraphIndex: 18, statementIds: Array(1), dominantStance: 'unclassified', …}
length
: 
38
statements
: 
Array(102)
[0 … 99]
0
: 
confidence
: 
0.8
fullParagraph
: 
"This is genuinely interesting work. The core idea — query multiple models, identify *real* disagreements, ask the user only the questions that would actually change the output — is elegant. The \"blast radius\" framing is particularly sharp as a way to prioritize what's worth surfacing vs. silently passing through."
geometricCoordinates
: 
componentId
: 
"comp_0"
isolationScore
: 
0.173722
knnDegree
: 
11
mutualDegree
: 
4
paragraphId
: 
"p_0"
regionId
: 
"r_0"
id
: 
"s_0"
location
: 
paragraphIndex
: 
0
sentenceIndex
: 
0
modelIndex
: 
1
signals
: 
conditional
: 
false
sequence
: 
false
tension
: 
false
stance
: 
"assertive"
text
: 
"This is genuinely interesting work."
1
: 
{id: 's_1', modelIndex: 1, text: 'The core idea — query multiple models, identify *r…at would actually change the output — is elegant.', stance: 'assertive', confidence: 0.65, …}
2
: 
{id: 's_2', modelIndex: 1, text: `The "blast radius" framing is particularly sharp a…t's worth surfacing vs. silently passing through.`, stance: 'assertive', confidence: 0.65, …}
3
: 
{id: 's_3', modelIndex: 1, text: 'The protective bias section is the strongest part.', stance: 'assertive', confidence: 0.65, …}
4
: 
{id: 's_4', modelIndex: 1, text: 'Leading with "under-pruning is the expected failur…ate tradeoff rather than just hoping things work.', stance: 'assertive', confidence: 0.8, …}
5
: 
{id: 's_5', modelIndex: 1, text: 'The skeletonization concept (keep the bones when t…is memorable and communicates the intent quickly.', stance: 'assertive', confidence: 0.65, …}
6
: 
{id: 's_6', modelIndex: 1, text: 'The "What the Pipeline Cannot Do" section earns trust.', stance: 'assertive', confidence: 0.65, …}
7
: 
{id: 's_7', modelIndex: 1, text: 'The drug safety example — "Drug X is safe" and "Dr…llustration that makes abstract limitations land.', stance: 'assertive', confidence: 0.8, …}
8
: 
{id: 's_8', modelIndex: 1, text: "The document assumes the mapper works well enough …ut the mapper's failure modes feel underexplored.", stance: 'assertive', confidence: 0.65, …}
9
: 
{id: 's_9', modelIndex: 1, text: "Users probably won't see a flag — they'll just see fewer or different questions.", stance: 'unclassified', confidence: 0, …}
10
: 
{id: 's_10', modelIndex: 1, text: 'That gap between "the system detects a problem" an…s something is uncertain" seems worth addressing.', stance: 'uncertain', confidence: 0.325, …}
11
: 
{id: 's_11', modelIndex: 1, text: 'The threshold logic for surfacing questions feels …eloped compared to the depth on other components.', stance: 'unclassified', confidence: 0, …}
12
: 
{id: 's_12', modelIndex: 1, text: 'The writing is clean and confident.', stance: 'assertive', confidence: 0.65, …}
13
: 
{id: 's_13', modelIndex: 1, text: 'If this is for technical stakeholders who need to …t reading the engineering docs, it largely works.', stance: 'prescriptive', confidence: 0.21666666666666667, …}
14
: 
{id: 's_14', modelIndex: 1, text: "If it's also meant to reach product or business st…ge might lose them before the good stuff arrives.", stance: 'prerequisite', confidence: 0.325, …}
15
: 
{id: 's_15', modelIndex: 1, text: 'You could consider a one-paragraph "in plain terms…y top before getting into the pipeline mechanics.', stance: 'prerequisite', confidence: 0.21666666666666667, …}
16
: 
{id: 's_16', modelIndex: 2, text: 'This is a sophisticated, high-clarity breakdown of a complex technical architecture.', stance: 'assertive', confidence: 0.65, …}
17
: 
{id: 's_17', modelIndex: 2, text: 'You’ve managed to frame the "Geometry Pipeline" no…"rights" of the data through preservation biases.', stance: 'unclassified', confidence: 0, …}
18
: 
{id: 's_18', modelIndex: 2, text: 'Here are my thoughts on why this works, where the …der, and a few "witty" observations on the logic:', stance: 'uncertain', confidence: 0.21666666666666667, …}
19
: 
{id: 's_19', modelIndex: 2, text: "It immediately explains why this isn't just another RAG (Retrieval-Augmented Generation) system.", stance: 'unclassified', confidence: 0, …}
20
: 
{id: 's_20', modelIndex: 2, text: "You aren't just finding info; you’re performing a controlled demolition of irrelevant data.", stance: 'unclassified', confidence: 0, …}
21
: 
{id: 's_21', modelIndex: 2, text: '* **"The Protective Bias":** Explicitly stating th…ut complete" over "clean but lossy" builds trust.', stance: 'unclassified', confidence: 0, …}
22
: 
{id: 's_22', modelIndex: 2, text: `It tells the user: "We won't hallucinate by omissi…uctural Skeleton" Concept:** This is fascinating.`, stance: 'assertive', confidence: 0.65, …}
23
: 
{id: 's_23', modelIndex: 2, text: 'Keeping the "bones" (nouns/names) when the "flesh"…ay to maintain context without keeping the noise.', stance: 'assertive', confidence: 0.65, …}
24
: 
{id: 's_24', modelIndex: 2, text: 'It’s like a redacted document that still lets you see the shape of the conversation.', stance: 'unclassified', confidence: 0, …}
25
: 
{id: 's_25', modelIndex: 2, text: 'However, a non-technical stakeholder might find this terrifying.', stance: 'uncertain', confidence: 0.65, …}
26
: 
{id: 's_26', modelIndex: 2, text: 'It might be worth a one-sentence "Hand-off" explan…those skeletons into smooth, natural transitions.', stance: 'uncertain', confidence: 0.325, …}
27
: 
{id: 's_27', modelIndex: 2, text: '* **The "Undo" Mechanism:** You mentioned the system is recoverable but has no "Undo" button yet.', stance: 'assertive', confidence: 0.8, …}
28
: 
{id: 's_28', modelIndex: 2, text: 'In a product pitch, that’s a "Fast Follow" feature.', stance: 'unclassified', confidence: 0, …}
29
: 
{id: 's_29', modelIndex: 2, text: 'It’s a vulnerability that actually highlights the strength of your "stored primitives" architecture.', stance: 'unclassified', confidence: 0, …}
30
: 
{id: 's_30', modelIndex: 2, text: 'It’s a "feature" of reality—sometimes things are just similar.', stance: 'assertive', confidence: 0.65, …}
31
: 
{id: 's_31', modelIndex: 2, text: '* **"Under-pruning is the expected failure mode":*…little extra homework than delete your paycheck."', stance: 'assertive', confidence: 0.65, …}
32
: 
{id: 's_32', modelIndex: 2, text: '| Feature | The Mapper (The Brain) | The Pipeline …d?" |\n| **Goal** | Identify claims/disagreements.', stance: 'assertive', confidence: 0.65, …}
33
: 
{id: 's_33', modelIndex: 2, text: '| Measure the "blast radius" of a choice.', stance: 'unclassified', confidence: 0, …}
34
: 
{id: 's_34', modelIndex: 2, text: '|\n| **Failure Mode** | Hallucination (Making things up).', stance: 'unclassified', confidence: 0, …}
35
: 
{id: 's_35', modelIndex: 2, text: '| Noise (Leaving too much in).', stance: 'unclassified', confidence: 0, …}
36
: 
{id: 's_36', modelIndex: 2, text: '**Overall Impression:** This reads like a manifest…le prompting into actual information engineering.', stance: 'unclassified', confidence: 0, …}
37
: 
{id: 's_37', modelIndex: 2, text: 'It’s grounded, transparent about its limitations, … the most expensive resource: **user attention.**', stance: 'unclassified', confidence: 0, …}
38
: 
{id: 's_38', modelIndex: 3, text: 'This is a sophisticated, high-clarity breakdown of a complex architecture.', stance: 'assertive', confidence: 0.65, …}
39
: 
{id: 's_39', modelIndex: 3, text: `You’ve managed to frame a highly technical "multi-…t values the user's time and intellectual agency.`, stance: 'unclassified', confidence: 0, …}
40
: 
{id: 's_40', modelIndex: 3, text: 'It moves the conversation away from "AI hallucinat…is is your strongest philosophical selling point.', stance: 'assertive', confidence: 0.65, …}
41
: 
{id: 's_41', modelIndex: 3, text: `In an era where AI often over-summarizes (losing n…100% sure you don't need it,"* builds deep trust.`, stance: 'cautionary', confidence: 0.65, …}
42
: 
{id: 's_42', modelIndex: 3, text: '* **The "Carrier" Concept:** The idea of "skeleton…a statement rather than deleting it is brilliant.', stance: 'assertive', confidence: 0.65, …}
43
: 
{id: 's_43', modelIndex: 3, text: 'It maintains the structural integrity of the logic without the "meat" of the rejected argument.', stance: 'unclassified', confidence: 0, …}
44
: 
{id: 's_44', modelIndex: 3, text: 'This is a classic embedding limitation.', stance: 'assertive', confidence: 0.65, …}
45
: 
{id: 's_45', modelIndex: 3, text: 'You state the "Mapper" handles meaning—but if the …heir proximity, the synthesis will be a disaster.', stance: 'unclassified', confidence: 0, …}
46
: 
{id: 's_46', modelIndex: 3, text: 'It might be worth explicitly stating that the Mapp…e the Pipeline provides the "math" to back it up.', stance: 'uncertain', confidence: 0.5333333333333333, …}
47
: 
{id: 's_47', modelIndex: 3, text: 'There’s a risk the final output sounds like a "ran…d nouns if the skeletonization is too aggressive.', stance: 'cautionary', confidence: 0.325, …}
48
: 
{id: 's_48', modelIndex: 3, text: '* **User Fatigue:** You mention asking 1–3 "high blast radius" questions.', stance: 'unclassified', confidence: 0, …}
49
: 
{id: 's_49', modelIndex: 3, text: '| Section | Suggestion |\n| :--- | :--- |\n| **The P…m forces the hidden disagreements into the light.', stance: 'unclassified', confidence: 0, …}
50
: 
{id: 's_50', modelIndex: 3, text: `|\n| **The Pipeline** | Use the term **"Semantic Au…the "CPA" checking the "CEO's" (Mapper's) claims.`, stance: 'prescriptive', confidence: 0.325, …}
51
: 
{id: 's_51', modelIndex: 3, text: '|\n| **Limitations** | You might add a note on **La…s a geometric audit is computationally expensive.', stance: 'uncertain', confidence: 0.325, …}
52
: 
{id: 's_52', modelIndex: 3, text: "It acknowledges that the AI isn't perfect.", stance: 'unclassified', confidence: 0, …}
53
: 
{id: 's_53', modelIndex: 3, text: `By allowing "noise" over "loss," you're positionin…eed a "perfect" (and therefore sanitized) answer.`, stance: 'unclassified', confidence: 0, …}
54
: 
{id: 's_54', modelIndex: 4, text: 'This is an exceptionally well-thought-out architectural overview.', stance: 'assertive', confidence: 0.65, …}
55
: 
{id: 's_55', modelIndex: 4, text: 'You’ve managed to take a highly complex, multi-lay…a way that feels intuitive, grounded, and visual.', stance: 'unclassified', confidence: 0, …}
56
: 
{id: 's_56', modelIndex: 4, text: 'If your goal is to bridge the gap between engineer…ip, this document hits the exact right frequency.', stance: 'assertive', confidence: 0.65, …}
57
: 
{id: 's_57', modelIndex: 4, text: 'Here is my analysis of both **the system design** …lf**, along with a few constructive provocations.', stance: 'assertive', confidence: 0.65, …}
58
: 
{id: 's_58', modelIndex: 4, text: '* **The Separation of Concerns:** Explicitly divid…tial auditing) is a massive structural advantage.', stance: 'assertive', confidence: 0.65, …}
59
: 
{id: 's_59', modelIndex: 4, text: 'It prevents the system from trying to be too clever and failing silently.', stance: 'unclassified', confidence: 0, …}
60
: 
{id: 's_60', modelIndex: 4, text: '* **The "Blast Radius" Concept:** This is brilliant UX disguised as backend engineering.', stance: 'assertive', confidence: 0.65, …}
61
: 
{id: 's_61', modelIndex: 4, text: 'By calculating what is actually consequential befo…ith interactive AI agents: interrogation fatigue.', stance: 'prerequisite', confidence: 0.21666666666666667, …}
62
: 
{id: 's_62', modelIndex: 4, text: '* **Default to Preservation:** The "protective bia…ntent when no carrier exists is incredibly smart.', stance: 'assertive', confidence: 0.8, …}
63
: 
{id: 's_63', modelIndex: 4, text: 'It ensures the final synthesizer still has the raw…without the argumentative spin the user rejected.', stance: 'assertive', confidence: 0.65, …}
64
: 
{id: 's_64', modelIndex: 4, text: '* **Honesty About Limitations:** Calling out that …efault to "under-pruning" builds immediate trust.', stance: 'unclassified', confidence: 0, …}
65
: 
{id: 's_65', modelIndex: 4, text: "It tells the reader exactly where the system's boundaries lie.", stance: 'unclassified', confidence: 0, …}
66
: 
{id: 's_66', modelIndex: 4, text: 'You noted this is for anyone who needs to understand it *without reading engineering documents*.', stance: 'assertive', confidence: 0.65, …}
67
: 
{id: 's_67', modelIndex: 4, text: 'For Product Managers, UX Designers, and technical leadership, this is perfect.', stance: 'assertive', confidence: 0.65, …}
68
: 
{id: 's_68', modelIndex: 4, text: 'However, if this is also meant for Sales, Marketin…se mean, but they are still deep-learning jargon.', stance: 'cautionary', confidence: 0.1625, …}
69
: 
{id: 's_69', modelIndex: 4, text: 'Consider adding a half-sentence analogy (e.g., *"i…reating concepts like coordinates on a map..."*).', stance: 'prescriptive', confidence: 0.65, …}
70
: 
{id: 's_70', modelIndex: 4, text: "Looking at the reality of how LLMs behave, here ar… run into that aren't addressed in this document:", stance: 'uncertain', confidence: 0.325, …}
71
: 
{id: 's_71', modelIndex: 4, text: 'The pipeline will see a massive evidence pool, hig…last radius (because the evidence is everywhere).', stance: 'assertive', confidence: 0.65, …}
72
: 
{id: 's_72', modelIndex: 4, text: 'It will pass right through to synthesis as a core truth.', stance: 'unclassified', confidence: 0, …}
73
: 
{id: 's_73', modelIndex: 4, text: '2.  **Latency Realities:** Querying 6 models, runn…nthesizer is a heavy, multi-step sequential loop.', stance: 'assertive', confidence: 0.65, …}
74
: 
{id: 's_74', modelIndex: 4, text: 'Time-to-first-token is going to be a major UX hurdle.', stance: 'prerequisite', confidence: 0.325, …}
75
: 
{id: 's_75', modelIndex: 4, text: '3.  **The "Skeleton" Output:** Reducing rejected s… a massive burden on the final Synthesizer model.', stance: 'assertive', confidence: 0.65, …}
76
: 
{id: 's_76', modelIndex: 4, text: "The Synthesizer has to seamlessly stitch together … final output read like a Frankenstein's monster.", stance: 'assertive', confidence: 0.65, …}
77
: 
{id: 's_77', modelIndex: 4, text: 'Overall, you are building a highly sophisticated "…ctual context at the center of the routing logic.', stance: 'assertive', confidence: 0.65, …}
78
: 
{id: 's_78', modelIndex: 4, text: 'The documentation captures the elegance of that perfectly.', stance: 'unclassified', confidence: 0, …}
79
: 
{id: 's_79', modelIndex: 5, text: 'This is an exceptionally clear, thoughtful, and we…structured explanation of a sophisticated system.', stance: 'assertive', confidence: 0.65, …}
80
: 
{id: 's_80', modelIndex: 5, text: 'Here’s what stands out—and why it matters:', stance: 'unclassified', confidence: 0, …}
81
: 
{id: 's_81', modelIndex: 5, text: 'Hybrid Thinking OS bridges this by **preserving multiplicity while enforcing relevance**.', stance: 'unclassified', confidence: 0, …}
82
: 
{id: 's_82', modelIndex: 5, text: 'The core innovation isn’t just *aggregating* persp… constraints (which they often can’t articulate).', stance: 'unclassified', confidence: 0, …}
83
: 
{id: 's_83', modelIndex: 5, text: '> *"The system doesn’t ask users what they want upfront.', stance: 'unclassified', confidence: 0, …}
84
: 
{id: 's_84', modelIndex: 5, text: 'It reads all six model responses, identifies where… of identifying decision points**, not the human.', stance: 'assertive', confidence: 0.8, …}
85
: 
{id: 's_85', modelIndex: 5, text: 'Key strengths:  \n- **Evidence-aware pruning**: Doe…stance* survives elsewhere (*carrier detection*).', stance: 'unclassified', confidence: 0, …}
86
: 
{id: 's_86', modelIndex: 5, text: '- **Blast radius scoring**: Prevents trivial decisions from cluttering the UI.', stance: 'unclassified', confidence: 0, …}
87
: 
{id: 's_87', modelIndex: 5, text: '- **Skeletonization**: Even when content is rejected, structural anchors (nouns, numbers) remain.', stance: 'assertive', confidence: 0.65, …}
88
: 
{id: 's_88', modelIndex: 5, text: 'This avoids *false erasure*—a huge risk in summarization systems.', stance: 'cautionary', confidence: 0.65, …}
89
: 
{id: 's_89', modelIndex: 5, text: 'This isn’t just engineering—it’s **epistemic humility** baked into the architecture.', stance: 'unclassified', confidence: 0, …}
90
: 
{id: 's_90', modelIndex: 5, text: '- **Mapper dependency**: The pipeline audits but doesn’t replace the claim mapper.', stance: 'unclassified', confidence: 0, …}
91
: 
{id: 's_91', modelIndex: 5, text: 'Garbage in = geometrically precise garbage out.', stance: 'unclassified', confidence: 0, …}
92
: 
{id: 's_92', modelIndex: 5, text: '- **No undo (yet)**: User errors are faithfully executed—a tradeoff between agency and safety.', stance: 'assertive', confidence: 0.65, …}
93
: 
{id: 's_93', modelIndex: 5, text: 'This transparency is rare and valuable.', stance: 'assertive', confidence: 0.65, …}
94
: 
{id: 's_94', modelIndex: 5, text: 'It sets realistic expectations while highlighting …g., better embedding models, undo functionality).', stance: 'uncertain', confidence: 0.325, …}
95
: 
{id: 's_95', modelIndex: 5, text: '- *Low blast radius* = safe to auto-resolve without user input.', stance: 'unclassified', confidence: 0, …}
96
: 
{id: 's_96', modelIndex: 5, text: '- *Convergent field warnings* = "Your query is too narrow for meaningful differentiation."', stance: 'assertive', confidence: 0.65, …}
97
: 
{id: 's_97', modelIndex: 5, text: 'This turns the system into a **collaborative sensemaking tool**, not just an answer engine.', stance: 'unclassified', confidence: 0, …}
98
: 
{id: 's_98', modelIndex: 5, text: 'The "recovery worklist" helps, but without an undo…synthesis could drift from the user’s true needs.', stance: 'uncertain', confidence: 0.65, …}
99
: 
{id: 's_99', modelIndex: 5, text: 'A future iteration might:  \n- Flag low-confidence …n a collapsible "discarded perspectives" section.', stance: 'uncertain', confidence: 0.65, …}
[100 … 101]
length
: 
102
[[Prototype]]
: 
Array(0)
traversal
: 
forcingPoints
: 
Array(0)
length
: 
0
graph
: 
claims
: 
Array(10)
0
: 
conflicts
: 
Array(0)
length
: 
0
enables
: 
Array(0)
length
: 
0
gates
: 
conditionals
: 
Array(0)
length
: 
0
hasConditionalSignal
: 
true
hasSequenceSignal
: 
false
hasTensionSignal
: 
true
id
: 
"claim_1"
label
: 
"Prioritize user attention by surfacing only high-consequence decisions"
sourceStatementIds
: 
Array(12)
0
: 
"s_0"
1
: 
"s_1"
2
: 
"s_2"
3
: 
"s_49"
4
: 
"s_50"
5
: 
"s_51"
6
: 
"s_85"
7
: 
"s_86"
8
: 
"s_87"
9
: 
"s_88"
10
: 
"s_95"
11
: 
"s_96"
length
: 
12
stance
: 
"NEUTRAL"
supportRatio
: 
1
supporterModels
: 
Array(5)
0
: 
1
1
: 
2
2
: 
3
3
: 
4
4
: 
5
length
: 
5
tier
: 
0
1
: 
{id: 'claim_2', label: 'Default to preservation over deletion when pruning content', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
2
: 
{id: 'claim_3', label: 'Acknowledge that geometric proximity cannot distinguish semantic opposition', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
3
: 
{id: 'claim_4', label: 'Trust the Mapper as the sole authority on meaning despite its fallibility', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
4
: 
{id: 'claim_5', label: 'Limit user-facing questions to 1–3 even when more high-blast-radius claims exist', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
5
: 
{id: 'claim_6', label: 'Skeletonized content risks incoherent synthesis without robust final LLM handling', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
6
: 
{id: 'claim_7', label: 'Consensus hallucination may pass undetected due to geometric reinforcement', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
7
: 
{id: 'claim_8', label: 'Latency from six-model orchestration makes this unsuitable for real-time chat', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
8
: 
{id: 'claim_9', label: 'Diagnostic outputs enable collaborative sensemaking beyond answer generation', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
9
: 
{id: 'claim_10', label: 'User misunderstanding of a question can permanently corrupt output without undo', stance: 'NEUTRAL', gates: {…}, enables: Array(0), …}
length
: 
10
conditionals
: 
Array(0)
length
: 
0
cycles
: 
Array(0)
length
: 
0
edges
: 
Array(0)
length
: 
0
maxTier
: 
0
roots
: 
Array(0)
length
: 
0
tensions
: 
Array(0)
length
: 
0
tiers
: 
Array(1)
0
: 
claimIds
: 
Array(10)
0
: 
"claim_1"
1
: 
"claim_2"
2
: 
"claim_3"
3
: 
"claim_4"
4
: 
"claim_5"
5
: 
"claim_6"
6
: 
"claim_7"
7
: 
"claim_8"
8
: 
"claim_9"
9
: 
"claim_10"
length
: 
10
gates
: 
Array(0)
length
: 
0
tierIndex
: 
0
length
: 
1
completedAt
: 
1772147062880
createdAt
: 
1772147062880
id
: 
"pr-session-1772071684912-5jrs45-ai-1772071684912-cmnexq-qwen-mapping-1-1772147062880"
meta
: 
citationSourceOrder
: 
1
: 
"claude"
2
: 
"gemini"
3
: 
"gemini-exp"
4
: 
"gemini-pro"
5
: 
"qwen"
isRecompute
: 
true
rawMappingText
: 
"<map>\n{\n  \"claims\": [\n    {\n      \"id\": \"claim_1\",\n      \"label\": \"Prioritize user attention by surfacing only high-consequence decisions\",\n      \"text\": \"The system calculates 'blast radius'—a composite of exclusive evidence loss, cascade effects, and structural centrality—to determine which model disagreements warrant user input, suppressing low-impact claims (score < 0.20).\",\n      \"supporters\": [1, 2, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_2\",\n      \"label\": \"Default to preservation over deletion when pruning content\",\n      \"text\": \"Rejected claims are either removed only if a 'carrier' exists elsewhere or reduced to a 'structural skeleton' (nouns, numbers, names); unclaimed content passes through untouched to avoid silent loss.\",\n      \"supporters\": [1, 2, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_3\",\n      \"label\": \"Acknowledge that geometric proximity cannot distinguish semantic opposition\",\n      \"text\": \"Embedding space treats 'Drug X is safe' and 'Drug X is dangerous' as similar because they discuss the same topic; meaning interpretation is delegated to the Mapper, not the Geometry Pipeline.\",\n      \"supporters\": [1, 2, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_4\",\n      \"label\": \"Trust the Mapper as the sole authority on meaning despite its fallibility\",\n      \"text\": \"The pipeline audits the Mapper geometrically but cannot generate or correct claims; if the Mapper misidentifies a disagreement or fabricates a claim, the system may surface misleading questions or miss real tensions.\",\n      \"supporters\": [1, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_5\",\n      \"label\": \"Limit user-facing questions to 1–3 even when more high-blast-radius claims exist\",\n      \"text\": \"The product promises only 1–3 questions, raising unresolved tension about how surplus consequential claims are handled—whether truncated, merged, or deprioritized arbitrarily.\",\n      \"supporters\": [1],\n      \"challenges\": \"claim_1\"\n    },\n    {\n      \"id\": \"claim_6\",\n      \"label\": \"Skeletonized content risks incoherent synthesis without robust final LLM handling\",\n      \"text\": \"Reducing rejected statements to nouns and numbers places heavy burden on the synthesizer to produce fluent output; poor stitching could yield 'ransom-note' text or Frankenstein logic.\",\n      \"supporters\": [3, 4],\n      \"challenges\": \"claim_2\"\n    },\n    {\n      \"id\": \"claim_7\",\n      \"label\": \"Consensus hallucination may pass undetected due to geometric reinforcement\",\n      \"text\": \"If 4–6 models confidently agree on a false claim, the pipeline sees high evidence density, low exclusivity, and low blast radius—allowing the hallucination to survive pruning as 'settled truth.'\",\n      \"supporters\": [3],\n      \"challenges\": \"claim_2\"\n    },\n    {\n      \"id\": \"claim_8\",\n      \"label\": \"Latency from six-model orchestration makes this unsuitable for real-time chat\",\n      \"text\": \"The multi-step loop—querying six models, mapping, embedding analysis, user interaction, synthesis—introduces significant delay, suggesting the system is designed for high-stakes deliberation, not instant responses.\",\n      \"supporters\": [3, 4],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_9\",\n      \"label\": \"Diagnostic outputs enable collaborative sensemaking beyond answer generation\",\n      \"text\": \"Metrics like exclusivity, pool size, and convergence flags transform the system into a debugging partner, revealing structural properties of the response field rather than just delivering conclusions.\",\n      \"supporters\": [5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_10\",\n      \"label\": \"User misunderstanding of a question can permanently corrupt output without undo\",\n      \"text\": \"The system faithfully executes user rejections even if based on confusion; while primitives are stored for recovery, the current product lacks mechanisms to confirm or reverse such decisions.\",\n      \"supporters\": [1, 5],\n      \"challenges\": null\n    }\n  ],\n  \"edges\": [\n    {\n      \"from\": \"claim_5\",\n      \"to\": \"claim_1\",\n      \"type\": \"conflicts\"\n    },\n    {\n      \"from\": \"claim_6\",\n      \"to\": \"claim_2\",\n      \"type\": \"challenges\"\n    },\n    {\n      \"from\": \"claim_7\",\n      \"to\": \"claim_2\",\n      \"type\": \"challenges\"\n    },\n    {\n      \"from\": \"claim_2\",\n      \"to\": \"claim_10\",\n      \"type\": \"prerequisite\"\n    },\n    {\n      \"from\": \"claim_1\",\n      \"to\": \"claim_9\",\n      \"type\": \"supports\"\n    }\n  ]\n}\n</map>\n\n<narrative>\nThe architecture pivots on a single tradeoff: **fidelity to multiplicity versus fluency of delivery**—how much structural complexity should be preserved when the user rejects a perspective, and at what cost to coherence or speed?\n\nThe models converge on a shared foundation. All five affirm that [Prioritize user attention by surfacing only high-consequence decisions|claim_1] is central to the system’s value, using “blast radius” as the gatekeeper of interruption. Equally settled is [Default to preservation over deletion when pruning content|claim_2]: the protective bias ensures under-pruning, not over-cleaning. And all recognize the hard boundary that [geometric proximity cannot distinguish semantic opposition|claim_3], delegating meaning to the Mapper while the Pipeline measures only spatial affinity.\n\nBut this consensus floor gives way to tension at the edges. Model 1 alone challenges the scalability of attention conservation with [Limit user-facing questions to 1–3 even when more high-blast-radius claims exist|claim_5], exposing a conflict with [claim_1]: if blast radius truly measures consequence, why cap questions arbitrarily? This isn’t refinement—it’s constraint masquerading as curation.\n\nMore critically, two positions challenge the safety of preservation itself. [Skeletonized content risks incoherent synthesis|claim_6] (Models 3, 4) warns that keeping “bones” without “flesh” may fracture the final narrative unless the synthesizer is exceptionally capable. Even sharper is [Consensus hallucination may pass undetected|claim_7] (Model 3), which argues that the very mechanism designed to preserve truth—high evidence density—can amplify falsehood when multiple models err together. Both directly interrogate the premise of [claim_2], suggesting that defaulting to preservation isn’t always epistemically humble—it can be dangerously naive.\n\nThese outliers sit adjacent to dependencies. Note that [claim_2]’s promise of safe pruning becomes precarious without safeguards against [User misunderstanding of a question can permanently corrupt output|claim_10] (Models 1, 5)—a vulnerability made possible precisely because the system trusts user input absolutely. Meanwhile, [Diagnostic outputs enable collaborative sensemaking|claim_9] (Model 5) emerges not as an add-on but as a natural extension of [claim_1]: if you measure consequence, you must show the metrics.\n\nUncharted remain three ghosts. First: **How does the Mapper actually work?** Every model assumes its competence but none describe its logic—leaving a black box at the heart of meaning-making. Second: **What defines a “carrier” beyond similarity thresholds?** The pipeline’s conservative bar avoids false equivalence, but no model explains how semantic equivalence is approximated without understanding meaning. Third: **Who is the user?** Is this for engineers debugging architectures or executives needing crisp recommendations? The tone straddles both, but the embedding jargon and skeleton metaphors may not survive translation across that divide.\n\nThe landscape, then, is not flat consensus but layered caution: a core of agreed principles surrounded by concentric rings of risk—implementation fragility, synthesis brittleness, and epistemic blind spots—each revealed not by disagreement among models, but by what only one dared to name.\n</narrative>"
recomputeDate
: 
1772147062880
semanticMapperPrompt
: 
"You are the Epistemic Cartographer. Your mandate 
providerId
: 
"qwen"
responseIndex
: 
1
responseType
: 
"mapping"
sessionId
: 
"session-1772071684912-5jrs45"
status
: 
"completed"
text
: 
"<map>\n{\n  \"claims\": [\n    {\n      \"id\": \"claim_1\",\n      \"label\": \"Prioritize user attention by surfacing only high-consequence decisions\",\n      \"text\": \"The system calculates 'blast radius'—a composite of exclusive evidence loss, cascade effects, and structural centrality—to determine which model disagreements warrant user input, suppressing low-impact claims (score < 0.20).\",\n      \"supporters\": [1, 2, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_2\",\n      \"label\": \"Default to preservation over deletion when pruning content\",\n      \"text\": \"Rejected claims are either removed only if a 'carrier' exists elsewhere or reduced to a 'structural skeleton' (nouns, numbers, names); unclaimed content passes through untouched to avoid silent loss.\",\n      \"supporters\": [1, 2, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_3\",\n      \"label\": \"Acknowledge that geometric proximity cannot distinguish semantic opposition\",\n      \"text\": \"Embedding space treats 'Drug X is safe' and 'Drug X is dangerous' as similar because they discuss the same topic; meaning interpretation is delegated to the Mapper, not the Geometry Pipeline.\",\n      \"supporters\": [1, 2, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_4\",\n      \"label\": \"Trust the Mapper as the sole authority on meaning despite its fallibility\",\n      \"text\": \"The pipeline audits the Mapper geometrically but cannot generate or correct claims; if the Mapper misidentifies a disagreement or fabricates a claim, the system may surface misleading questions or miss real tensions.\",\n      \"supporters\": [1, 3, 4, 5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_5\",\n      \"label\": \"Limit user-facing questions to 1–3 even when more high-blast-radius claims exist\",\n      \"text\": \"The product promises only 1–3 questions, raising unresolved tension about how surplus consequential claims are handled—whether truncated, merged, or deprioritized arbitrarily.\",\n      \"supporters\": [1],\n      \"challenges\": \"claim_1\"\n    },\n    {\n      \"id\": \"claim_6\",\n      \"label\": \"Skeletonized content risks incoherent synthesis without robust final LLM handling\",\n      \"text\": \"Reducing rejected statements to nouns and numbers places heavy burden on the synthesizer to produce fluent output; poor stitching could yield 'ransom-note' text or Frankenstein logic.\",\n      \"supporters\": [3, 4],\n      \"challenges\": \"claim_2\"\n    },\n    {\n      \"id\": \"claim_7\",\n      \"label\": \"Consensus hallucination may pass undetected due to geometric reinforcement\",\n      \"text\": \"If 4–6 models confidently agree on a false claim, the pipeline sees high evidence density, low exclusivity, and low blast radius—allowing the hallucination to survive pruning as 'settled truth.'\",\n      \"supporters\": [3],\n      \"challenges\": \"claim_2\"\n    },\n    {\n      \"id\": \"claim_8\",\n      \"label\": \"Latency from six-model orchestration makes this unsuitable for real-time chat\",\n      \"text\": \"The multi-step loop—querying six models, mapping, embedding analysis, user interaction, synthesis—introduces significant delay, suggesting the system is designed for high-stakes deliberation, not instant responses.\",\n      \"supporters\": [3, 4],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_9\",\n      \"label\": \"Diagnostic outputs enable collaborative sensemaking beyond answer generation\",\n      \"text\": \"Metrics like exclusivity, pool size, and convergence flags transform the system into a debugging partner, revealing structural properties of the response field rather than just delivering conclusions.\",\n      \"supporters\": [5],\n      \"challenges\": null\n    },\n    {\n      \"id\": \"claim_10\",\n      \"label\": \"User misunderstanding of a question can permanently corrupt output without undo\",\n      \"text\": \"The system faithfully executes user rejections even if based on confusion; while primitives are stored for recovery, the current product lacks mechanisms to confirm or reverse such decisions.\",\n      \"supporters\": [1, 5],\n      \"challenges\": null\n    }\n  ],\n  \"edges\": [\n    {\n      \"from\": \"claim_5\",\n      \"to\": \"claim_1\",\n      \"type\": \"conflicts\"\n    },\n    {\n      \"from\": \"claim_6\",\n      \"to\": \"claim_2\",\n      \"type\": \"challenges\"\n    },\n    {\n      \"from\": \"claim_7\",\n      \"to\": \"claim_2\",\n      \"type\": \"challenges\"\n    },\n    {\n      \"from\": \"claim_2\",\n      \"to\": \"claim_10\",\n      \"type\": \"prerequisite\"\n    },\n    {\n      \"from\": \"claim_1\",\n      \"to\": \"claim_9\",\n      \"type\": \"supports\"\n    }\n  ]\n}\n</map>\n\n<narrative>\nThe architecture pivots on a single tradeoff: **fidelity to multiplicity versus fluency of delivery**—how much structural complexity should be preserved when the user rejects a perspective, and at what cost to coherence or speed?\n\nThe models converge on a shared foundation. All five affirm that [Prioritize user attention by surfacing only high-consequence decisions|claim_1] is central to the system’s value, using “blast radius” as the gatekeeper of interruption. Equally settled is [Default to preservation over deletion when pruning content|claim_2]: the protective bias ensures under-pruning, not over-cleaning. And all recognize the hard boundary that [geometric proximity cannot distinguish semantic opposition|claim_3], delegating meaning to the Mapper while the Pipeline measures only spatial affinity.\n\nBut this consensus floor gives way to tension at the edges. Model 1 alone challenges the scalability of attention conservation with [Limit user-facing questions to 1–3 even when more high-blast-radius claims exist|claim_5], exposing a conflict with [claim_1]: if blast radius truly measures consequence, why cap questions arbitrarily? This isn’t refinement—it’s constraint masquerading as curation.\n\nMore critically, two positions challenge the safety of preservation itself. [Skeletonized content risks incoherent synthesis|claim_6] (Models 3, 4) warns that keeping “bones” without “flesh” may fracture the final narrative unless the synthesizer is exceptionally capable. Even sharper is [Consensus hallucination may pass undetected|claim_7] (Model 3), which argues that the very mechanism designed to preserve truth—high evidence density—can amplify falsehood when multiple models err together. Both directly interrogate the premise of [claim_2], suggesting that defaulting to preservation isn’t always epistemically humble—it can be dangerously naive.\n\nThese outliers sit adjacent to dependencies. Note that [claim_2]’s promise of safe pruning becomes precarious without safeguards against [User misunderstanding of a question can permanently corrupt output|claim_10] (Models 1, 5)—a vulnerability made possible precisely because the system trusts user input absolutely. Meanwhile, [Diagnostic outputs enable collaborative sensemaking|claim_9] (Model 5) emerges not as an add-on but as a natural extension of [claim_1]: if you measure consequence, you must show the metrics.\n\nUncharted remain three ghosts. First: **How does the Mapper actually work?** Every model assumes its competence but none describe its logic—leaving a black box at the heart of meaning-making. Second: **What defines a “carrier” beyond similarity thresholds?** The pipeline’s conservative bar avoids false equivalence, but no model explains how semantic equivalence is approximated without understanding meaning. Third: **Who is the user?** Is this for engineers debugging architectures or executives needing crisp recommendations? The tone straddles both, but the embedding jargon and skeleton metaphors may not survive translation across that divide.\n\nThe landscape, then, is not flat consensus but layered caution: a core of agreed principles surrounded by concentric rings of risk—implementation fragility, synthesis brittleness, and epistemic blind spots—each revealed not by disagreement among models, but by what only one dared to name.\n</narrative>"
updatedAt
: 
1772147279476