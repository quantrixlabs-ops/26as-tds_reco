"""
Benchmark & profile the optimizer to find bottlenecks.
Usage: python3 benchmark.py
"""
import cProfile
import pstats
import time
import random
import string
from engine.optimizer import run_global_optimizer, BookEntry, As26Entry

def _rand_ref():
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=10))

def _rand_date():
    m = random.choice(["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"])
    d = random.randint(1,28)
    return f"{d:02d}-{m}-2024"

def generate_test_data(n_26as: int, n_books: int, match_ratio: float = 0.7):
    """Generate synthetic test data with known match ratio."""
    as26_entries = []
    book_entries = []

    # Generate 26AS entries
    for i in range(n_26as):
        amt = round(random.uniform(1000, 500000), 2)
        as26_entries.append(As26Entry(
            index=i, amount=amt, transaction_date=_rand_date(),
            section=random.choice(["194C","194J","194H","194A","194Q"]),
            tan=f"MUMA{random.randint(10000,99999)}A",
            deductor_name=f"DEDUCTOR_{i}",
        ))

    # Generate matching books (some will match, some won't)
    book_idx = 0
    clr_doc_counter = 1000
    for i in range(n_26as):
        if random.random() < match_ratio:
            # Create a matching book entry (exact or near-exact)
            variance = random.uniform(0, 0.015) * as26_entries[i].amount
            clr = str(clr_doc_counter)
            clr_doc_counter += 1
            book_entries.append(BookEntry(
                index=book_idx, invoice_ref=_rand_ref(),
                amount=round(as26_entries[i].amount - variance, 2),
                doc_date=_rand_date(), doc_type="RV",
                clearing_doc=clr, sap_fy="FY2023-24",
            ))
            book_idx += 1

    # Add extra unmatched books (noise)
    for _ in range(n_books - len(book_entries)):
        book_entries.append(BookEntry(
            index=book_idx, invoice_ref=_rand_ref(),
            amount=round(random.uniform(500, 300000), 2),
            doc_date=_rand_date(), doc_type="RV",
            clearing_doc=str(clr_doc_counter), sap_fy="FY2023-24",
        ))
        book_idx += 1
        clr_doc_counter += 1

    random.shuffle(book_entries)
    # Reindex after shuffle
    for i, b in enumerate(book_entries):
        b.index = i

    return as26_entries, book_entries


def benchmark(n_26as: int, n_books: int, label: str):
    print(f"\n{'='*70}")
    print(f"  {label}: {n_26as} 26AS entries x {n_books} SAP books")
    print(f"{'='*70}")

    as26, books = generate_test_data(n_26as, n_books)
    current_books = books[:]
    prior_books = []

    # Time the run
    t0 = time.perf_counter()
    all_results, unmatched = run_global_optimizer(
        as26_entries=as26, book_pool=books,
        current_books=current_books, prior_books=prior_books,
        allow_cross_fy=False,
    )
    elapsed = time.perf_counter() - t0
    matched = [r for r in all_results if not r.suggested]
    suggested = [r for r in all_results if r.suggested]

    print(f"  Matched: {len(matched)}, Suggested: {len(suggested)}, Unmatched: {len(unmatched)}")
    print(f"  Match rate: {len(matched)/len(as26)*100:.1f}%")
    print(f"  Time: {elapsed:.2f}s")
    return elapsed


def profile(n_26as: int, n_books: int):
    print(f"\n{'='*70}")
    print(f"  PROFILING: {n_26as} 26AS x {n_books} books")
    print(f"{'='*70}")

    as26, books = generate_test_data(n_26as, n_books)
    current_books = books[:]

    profiler = cProfile.Profile()
    profiler.enable()
    all_results, unmatched = run_global_optimizer(
        as26_entries=as26, book_pool=books,
        current_books=current_books, prior_books=[],
        allow_cross_fy=False,
    )
    matched = [r for r in all_results if not r.suggested]
    suggested = [r for r in all_results if r.suggested]
    profiler.disable()

    stats = pstats.Stats(profiler)
    stats.sort_stats('cumulative')
    print("\n  Top 20 by cumulative time:")
    stats.print_stats(20)

    stats.sort_stats('tottime')
    print("\n  Top 20 by total time (self):")
    stats.print_stats(20)


if __name__ == "__main__":
    random.seed(42)

    # Small
    benchmark(50, 200, "SMALL")

    # Medium (typical single-party)
    benchmark(200, 1000, "MEDIUM")

    # Large (the failing case — similar to user's dataset)
    benchmark(500, 3000, "LARGE")

    # Extra large
    benchmark(1000, 5000, "EXTRA LARGE")

    # Profile the large case
    random.seed(42)
    profile(500, 3000)
